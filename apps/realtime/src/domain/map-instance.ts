/**
 * MapInstance — agregado de domínio: um mapa rodando em memória (02 §5.1).
 *
 * Responsável por: entrada/saída, validação de movimento (04 §4), zonas e capacidade (M3),
 * AOI + snapshots delta por cliente (04 §2.2), ghost/resume (04 §5), quem ouve quem (04 §8),
 * sentar, "Ir até" e status. Puro: sem rede, sem relógio global, sem LiveKit — tudo entra por portas.
 */
import {
  Facing,
  packState,
  WORLD,
  type AvatarLook,
  type AvatarState,
  type AudiblePeer,
  type CorrectionReason,
  type EmoteKind,
  type EntityInfo,
  type EntityUpdate,
  type InputFrame,
  type PresenceStatus,
  type ServerMsg,
  type SnapshotFrame,
  seqNewer,
} from '@cesar-office/protocol';
import { nearestFreeTile, type PrivateZone, type WorldMap } from '@cesar-office/world';
import { AudioPairing, DEFAULT_AUDIO_PARAMS } from './audio-pairing.ts';
import { SpatialGrid } from './spatial-grid.ts';

// ───────────────────────────── Portas ─────────────────────────────

/** Saída do agregado. Implementada pela camada de aplicação (que conhece conexões e LiveKit). */
export interface InstanceOutput {
  control(userId: string, msg: ServerMsg): void;
  /**
   * false = backpressure: o snapshot não foi enviado e o delta será reenviado depois.
   * O frame só é válido DURANTE a chamada (o array de entidades é reutilizado entre clientes):
   * codifique ou copie antes de retornar.
   */
  snapshot(userId: string, frame: SnapshotFrame): boolean;
  zoneChanged(userId: string, from: PrivateZone | null, to: PrivateZone | null): void;
  statusChanged(userId: string, status: PresenceStatus): void;
  abuse(userId: string): void;
  left(userId: string): void;
}

export interface InstanceConfig {
  readonly maxCcu: number;
  readonly ghostMs: number;
  readonly correctionIntervalMs: number;
  readonly maxCorrectionsPerMinute: number;
  readonly awayAfterMs: number;
  readonly netIdReuseDelayMs: number;
  readonly interactRadiusPx: number;
  /** Além desta distância (px), entidades vão a 5 Hz em vez de 10 Hz (LOD, 04 §2.2). */
  readonly lodRadiusPx: number;
  /** Intervalo mínimo entre emotes da mesma pessoa (ms). Evita "spam" de reações. */
  readonly emoteCooldownMs: number;
}

export const DEFAULT_INSTANCE_CONFIG: InstanceConfig = {
  maxCcu: 150,
  ghostMs: 30_000,
  correctionIntervalMs: 200,
  maxCorrectionsPerMinute: 20,
  awayAfterMs: 10 * 60_000,
  netIdReuseDelayMs: 60_000,
  interactRadiusPx: 1.5 * WORLD.TILE_PX + 8,
  lodRadiusPx: 16 * WORLD.TILE_PX, // ≈ meia largura da tela com zoom 2× (06 §1)
  emoteCooldownMs: 1_200,
};

export interface JoinRequest {
  readonly userId: string;
  readonly displayName: string;
  readonly look: AvatarLook;
  readonly status: PresenceStatus;
  /** Última posição salva (RN-M1-2 garante tile livre). */
  readonly lastPosition?: { readonly x: number; readonly y: number };
}

export type JoinResult =
  | { readonly ok: true; readonly netId: number; readonly resumeToken: string; readonly replaced: boolean; readonly entities: EntityInfo[]; readonly x: number; readonly y: number }
  | { readonly ok: false; readonly reason: 'full' | 'no_spawn' };

// ───────────────────────────── Estado interno ─────────────────────────────

interface Avatar {
  readonly netId: number;
  readonly userId: string;
  displayName: string;
  readonly look: AvatarLook;
  status: PresenceStatus;
  /** Status definido pelo sistema (Em reunião / Ausente automáticos), revertido ao sair da condição. */
  autoStatus: PresenceStatus | null;
  x: number;
  y: number;
  state: AvatarState;
  zone: PrivateZone | null;
  chairKey: string | null;
  lastAcceptedSeq: number;
  hasAcceptedSeq: boolean;
  lastAcceptedAt: number;
  lastCorrectionAt: number;
  corrections: number[];
  lastInputAt: number;
  ghostSince: number | null;
  resumeToken: string;
  readonly aoi: Set<number>;
  /** netId → chave (x,y,state) do último envio A ESTE cliente. */
  readonly lastSent: Map<number, number>;
  cellDirty: boolean;
  audible: Map<string, number>;
  bubbleId: string | null;
  lastEmoteAt: number;
}

const stateKey = (x: number, y: number, packed: number): number => x * 2 ** 24 + y * 2 ** 8 + packed;

export class MapInstance {
  private readonly byUser = new Map<string, Avatar>();
  private readonly byNet = new Map<number, Avatar>();
  private readonly byResume = new Map<string, Avatar>();
  private readonly grid = new SpatialGrid<number>(WORLD.AOI_CELL_TILES * WORLD.TILE_PX);
  private readonly audio: AudioPairing;
  private readonly chairs = new Map<string, string>(); // chairKey → userId
  private readonly releasedNetIds: { id: number; at: number }[] = [];
  private nextNetId = 1;
  private tickCount = 0;
  private lastAudioAt = -Infinity;
  private lastBubbleOf: ReadonlyMap<string, string> = new Map();
  private readonly scratch: EntityUpdate[] = [];

  constructor(
    readonly instanceId: string,
    readonly mapId: string,
    private readonly map: WorldMap,
    private readonly out: InstanceOutput,
    private readonly newToken: () => string,
    private readonly cfg: InstanceConfig = DEFAULT_INSTANCE_CONFIG,
  ) {
    this.audio = new AudioPairing(DEFAULT_AUDIO_PARAMS, (ax, ay, bx, by) => map.acoustics.segmentWalkable(ax, ay, bx, by));
  }

  // ───────────────────────────── consultas ─────────────────────────────

  get ccu(): number {
    let n = 0;
    for (const a of this.byUser.values()) if (a.ghostSince === null) n++;
    return n;
  }

  get tick(): number {
    return this.tickCount & 0xffff;
  }

  has(userId: string): boolean {
    return this.byUser.has(userId);
  }

  /** Membros que recebem chat "Aqui" de `userId`: mesma zona privada ou mesma bolha. Inclui o próprio. */
  hereAudience(userId: string): { channel: string | null; members: string[] } {
    const a = this.byUser.get(userId);
    if (!a || a.ghostSince !== null) return { channel: null, members: [] };
    if (a.zone) {
      const members = [...this.byUser.values()].filter((b) => b.ghostSince === null && b.zone?.key === a.zone?.key).map((b) => b.userId);
      return { channel: `zone:${this.mapId}:${a.zone.key}`, members };
    }
    const bubble = this.lastBubbleOf.get(userId);
    if (!bubble) return { channel: null, members: [userId] };
    const members: string[] = [];
    for (const [u, b] of this.lastBubbleOf) if (b === bubble) members.push(u);
    return { channel: null, members };
  }

  displayNameOf(userId: string): string | undefined {
    return this.byUser.get(userId)?.displayName;
  }

  statusOf(userId: string): PresenceStatus | undefined {
    return this.byUser.get(userId)?.status;
  }

  chairOf(userId: string): { key: string; deskKey?: string } | null {
    const a = this.byUser.get(userId);
    if (!a?.chairKey) return null;
    const it = this.map.interactables.find((i) => i.key === a.chairKey);
    return it ? { key: it.key, ...(it.deskKey !== undefined ? { deskKey: it.deskKey } : {}) } : null;
  }

  /** Zona atual (para a aplicação anunciar após o welcome/resume). */
  zoneOf(userId: string): PrivateZone | null {
    return this.byUser.get(userId)?.zone ?? null;
  }

  occupancyOf(zone: PrivateZone): number {
    return this.occupancy(zone);
  }

  positionOf(userId: string): { x: number; y: number } | undefined {
    const a = this.byUser.get(userId);
    return a ? { x: a.x, y: a.y } : undefined;
  }

  // ───────────────────────────── ciclo de vida ─────────────────────────────

  join(req: JoinRequest, now: number): JoinResult {
    const existing = this.byUser.get(req.userId);
    if (existing) {
      // Nova aba ou volta após queda sem resume: reaproveita o avatar (mesma posição, mesmo netId).
      const replaced = existing.ghostSince === null;
      this.revive(existing, now);
      existing.displayName = req.displayName;
      return { ok: true, netId: existing.netId, resumeToken: existing.resumeToken, replaced, entities: this.aoiEntities(existing), x: existing.x, y: existing.y };
    }
    if (this.ccu >= this.cfg.maxCcu) return { ok: false, reason: 'full' };

    const spot = this.spawnPoint(req.lastPosition);
    if (!spot) return { ok: false, reason: 'no_spawn' };
    const netId = this.allocNetId(now);
    const a: Avatar = {
      netId,
      userId: req.userId,
      displayName: req.displayName,
      look: req.look,
      status: req.status,
      autoStatus: null,
      x: spot.x,
      y: spot.y,
      state: { facing: 0, moving: false, sitting: false, ghost: false },
      zone: null,
      chairKey: null,
      lastAcceptedSeq: 0,
      hasAcceptedSeq: false,
      lastAcceptedAt: now,
      lastCorrectionAt: -Infinity,
      corrections: [],
      lastInputAt: now,
      ghostSince: null,
      resumeToken: this.newToken(),
      aoi: new Set(),
      lastSent: new Map(),
      cellDirty: true,
      audible: new Map(),
      bubbleId: null,
      lastEmoteAt: -Infinity,
    };
    this.byUser.set(a.userId, a);
    this.byNet.set(netId, a);
    this.byResume.set(a.resumeToken, a);
    this.grid.upsert(netId, a.x, a.y);
    // Sem mensagens para quem está entrando: o welcome carrega AOI e a aplicação envia a zona depois.
    a.zone = this.map.zoneAt(a.x, a.y);
    this.refreshAoi(a, false);
    return { ok: true, netId, resumeToken: a.resumeToken, replaced: false, entities: this.aoiEntities(a), x: a.x, y: a.y };
  }

  /** Conexão caiu: avatar vira ghost por `ghostMs` (04 §5). Libera vaga de zona e cadeira. */
  disconnect(userId: string, now: number): void {
    const a = this.byUser.get(userId);
    if (!a || a.ghostSince !== null) return;
    a.ghostSince = now;
    a.state = { ...a.state, moving: false, ghost: true };
    this.releaseChair(a);
    if (a.zone) this.out.zoneChanged(a.userId, a.zone, null); // sai da sala de mídia já
    a.audible = new Map();
  }

  /** Retoma pelo token. Retorna a AOI completa ou null (token desconhecido/expirado). */
  resume(token: string, now: number): { userId: string; entities: EntityInfo[]; resumeToken: string } | null {
    const a = this.byResume.get(token);
    if (!a || a.ghostSince === null || now - a.ghostSince > this.cfg.ghostMs) return null;
    this.byResume.delete(token);
    a.resumeToken = this.newToken();
    this.byResume.set(a.resumeToken, a);
    this.revive(a, now);
    return { userId: a.userId, entities: this.aoiEntities(a), resumeToken: a.resumeToken };
  }

  resumeTokenOf(userId: string): string | undefined {
    return this.byUser.get(userId)?.resumeToken;
  }

  /** Remoção imediata (expulso da org, desligamento). */
  remove(userId: string): void {
    const a = this.byUser.get(userId);
    if (a) this.destroy(a, Date.now());
  }

  // ───────────────────────────── movimento ─────────────────────────────

  applyInput(userId: string, f: InputFrame, now: number): void {
    const a = this.byUser.get(userId);
    if (!a || a.ghostSince !== null) return;
    if (a.hasAcceptedSeq && !seqNewer(f.seq, a.lastAcceptedSeq)) return; // duplicado/atrasado

    const moved = f.x !== a.x || f.y !== a.y;
    if (moved) {
      const dt = Math.min(1000, Math.max(50, now - a.lastAcceptedAt));
      const maxStep = (WORLD.WALK_SPEED_PX_S * WORLD.SPEED_TOLERANCE * dt) / 1000 + 4;
      if (Math.hypot(f.x - a.x, f.y - a.y) > maxStep) return this.reject(a, f.seq, 'speed', now);
      if (!this.map.grid.segmentWalkable(a.x, a.y, f.x, f.y)) return this.reject(a, f.seq, 'collision', now);
      const z = this.map.zoneAt(f.x, f.y);
      if (z && z.key !== a.zone?.key && this.occupancy(z) >= z.capacity) return this.reject(a, f.seq, 'zone_full', now);
    }

    a.lastAcceptedSeq = f.seq;
    a.hasAcceptedSeq = true;
    a.lastAcceptedAt = now;
    a.lastInputAt = now;
    if (moved && a.chairKey) this.releaseChair(a);
    a.state = { facing: f.state.facing, moving: f.state.moving, sitting: a.chairKey !== null, ghost: false };
    if (moved) this.place(a, f.x, f.y);
    if (a.autoStatus === 'away') this.setAutoStatus(a, null);
  }

  /** Sentar (RN-M7). Valida distância e ocupação; move o avatar para a cadeira. */
  interact(userId: string, objectKey: string, now: number): 'ok' | 'not_found' | 'too_far' | 'occupied' | 'not_interactive' {
    const a = this.byUser.get(userId);
    const it = this.map.interactables.find((i) => i.key === objectKey);
    if (!a || !it) return 'not_found';
    if (it.type !== 'chair') return 'not_interactive';
    if (Math.hypot(it.x - a.x, it.y - a.y) > this.cfg.interactRadiusPx) return 'too_far';
    const holder = this.chairs.get(it.key);
    if (holder && holder !== userId) return 'occupied';
    const z = this.map.zoneAt(it.x, it.y);
    if (z && z.key !== a.zone?.key && this.occupancy(z) >= z.capacity) return 'occupied';
    this.releaseChair(a);
    this.chairs.set(it.key, userId);
    a.chairKey = it.key;
    a.state = { ...a.state, facing: this.chairFacing(it.x, it.y, a.state.facing), moving: false, sitting: true };
    this.teleport(a, it.x, it.y, now);
    return 'ok';
  }

  /**
   * Reação rápida: aparece sobre o avatar para quem o vê (a própria pessoa + AOI).
   * Fantasmas não reagem. Custo O(|AOI|), sem varrer a instância.
   */
  emote(userId: string, kind: EmoteKind, now: number): 'ok' | 'not_found' | 'rate_limited' {
    const a = this.byUser.get(userId);
    if (!a || a.ghostSince !== null) return 'not_found';
    if (now - a.lastEmoteAt < this.cfg.emoteCooldownMs) return 'rate_limited';
    a.lastEmoteAt = now;
    a.lastInputAt = now;
    if (a.autoStatus === 'away') this.setAutoStatus(a, null);
    const msg: ServerMsg = { t: 'emote_shown', netId: a.netId, kind };
    this.out.control(a.userId, msg);
    for (const id of a.aoi) {
      const b = this.byNet.get(id);
      if (b && b.ghostSince === null) this.out.control(b.userId, msg);
    }
    return 'ok';
  }

  /** Quem senta olha para a mesa: o lado bloqueado (mesa) ao lado da cadeira. */
  private chairFacing(x: number, y: number, current: Facing): Facing {
    const t = this.map.tilePx;
    const tx = Math.floor(x / t);
    const ty = Math.floor(y / t);
    const g = this.map.grid;
    if (g.isBlockedTile(tx, ty + 1)) return Facing.Down;
    if (g.isBlockedTile(tx, ty - 1)) return Facing.Up;
    if (g.isBlockedTile(tx - 1, ty)) return Facing.Left;
    if (g.isBlockedTile(tx + 1, ty)) return Facing.Right;
    return current;
  }

  /** "Ir até" (RN-M6-1/2): ao lado do alvo, na mesma zona; alvo em zona privada → porta da zona. */
  goTo(userId: string, targetUserId: string, now: number): 'ok' | 'not_found' | 'no_space' {
    const a = this.byUser.get(userId);
    const t = this.byUser.get(targetUserId);
    if (!a || !t || t.ghostSince !== null || a === t) return 'not_found';
    const tile = this.map.tilePx;
    let dest: { tx: number; ty: number } | null;
    if (t.zone && t.zone.key !== a.zone?.key) {
      const door = this.map.doorOf(t.zone.key);
      if (!door) return 'no_space';
      dest = nearestFreeTile(this.map, Math.floor(door.x / tile), Math.floor(door.y / tile), 2, (x, y) => this.map.zoneAt((x + 0.5) * tile, (y + 0.5) * tile) === null);
    } else {
      const want = t.zone?.key ?? null;
      dest = nearestFreeTile(this.map, Math.floor(t.x / tile), Math.floor(t.y / tile), 2, (x, y) => {
        const z = this.map.zoneAt((x + 0.5) * tile, (y + 0.5) * tile);
        return (z?.key ?? null) === want && !(Math.floor(t.x / tile) === x && Math.floor(t.y / tile) === y);
      });
    }
    if (!dest) return 'no_space';
    this.releaseChair(a);
    a.state = { ...a.state, moving: false, sitting: false };
    this.teleport(a, (dest.tx + 0.5) * tile, (dest.ty + 0.5) * tile, now);
    return 'ok';
  }

  setStatus(userId: string, status: PresenceStatus): void {
    const a = this.byUser.get(userId);
    if (!a) return;
    a.autoStatus = null; // manual vence automático (RN-M4-2)
    this.applyStatus(a, status);
  }

  // ───────────────────────────── tick ─────────────────────────────

  step(now: number): void {
    this.tickCount++;

    // 1) Ghosts expirados e automação de Ausente
    for (const a of [...this.byUser.values()]) {
      if (a.ghostSince !== null && now - a.ghostSince > this.cfg.ghostMs) {
        this.destroy(a, now);
        continue;
      }
      if (a.ghostSince === null && a.status === 'available' && now - a.lastInputAt > this.cfg.awayAfterMs && a.audible.size === 0) {
        this.setAutoStatus(a, 'away');
      }
    }

    // 2) AOI de quem mudou de célula
    for (const a of this.byUser.values()) if (a.cellDirty) this.refreshAoi(a);

    // 3) Snapshots delta por cliente
    const tick = this.tick;
    const lodTick = (this.tickCount & 1) === 0;
    const lod2 = this.cfg.lodRadiusPx * this.cfg.lodRadiusPx;
    for (const a of this.byUser.values()) {
      if (a.ghostSince !== null) continue;
      const items = this.scratch;
      items.length = 0;
      for (const id of a.aoi) {
        const b = this.byNet.get(id);
        if (!b) continue;
        const packed = packState(b.state);
        const key = stateKey(b.x, b.y, packed);
        const prev = a.lastSent.get(id);
        if (prev === key) continue;
        // Longe: só em ticks pares (5 Hz). Mudança de estado (parar, sentar, ghost) sempre sai na hora.
        if (!lodTick && prev !== undefined && (prev & 0xff) === packed) {
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          if (dx * dx + dy * dy > lod2) continue;
        }
        items.push({ netId: id, x: b.x, y: b.y, state: b.state });
      }
      if (items.length === 0) continue;
      if (this.out.snapshot(a.userId, { tick, ackSeq: a.lastAcceptedSeq, entities: items })) {
        for (const e of items) a.lastSent.set(e.netId, stateKey(e.x, e.y, packState(e.state)));
      }
    }

    // 4) Áudio a cada BUBBLE_RECALC_MS
    if (now - this.lastAudioAt >= WORLD.BUBBLE_RECALC_MS) {
      this.lastAudioAt = now;
      this.recomputeAudio(now);
    }
  }

  // ───────────────────────────── internos ─────────────────────────────

  private recomputeAudio(now: number): void {
    const participants = [];
    for (const a of this.byUser.values()) {
      if (a.ghostSince !== null) continue;
      participants.push({ id: a.userId, x: a.x, y: a.y, zoneKey: a.zone?.key ?? null, dnd: a.status === 'dnd' });
    }
    const r = this.audio.compute(participants, now);
    this.lastBubbleOf = r.bubbleOf;
    for (const a of this.byUser.values()) {
      if (a.ghostSince !== null) continue;
      const next = r.audible.get(a.userId) ?? new Map<string, number>();
      const bubbleId = r.bubbleOf.get(a.userId) ?? null;
      if (!this.audibleChanged(a.audible, next) && bubbleId === a.bubbleId) continue;
      a.audible = new Map(next);
      a.bubbleId = bubbleId;
      const peers: AudiblePeer[] = [...next].map(([userId, volume]) => ({ userId, volume: Math.round(volume * 100) / 100 }));
      this.out.control(a.userId, { t: 'audible', peers, bubbleId });
    }
  }

  private audibleChanged(prev: ReadonlyMap<string, number>, next: ReadonlyMap<string, number>): boolean {
    if (prev.size !== next.size) return true;
    for (const [k, v] of next) {
      const p = prev.get(k);
      if (p === undefined || Math.abs(p - v) > 0.05) return true;
    }
    return false;
  }

  private reject(a: Avatar, seq: number, reason: CorrectionReason, now: number): void {
    // Em silêncio dentro da janela: descarta inputs que estavam em trânsito (04 §4 passo 4).
    if (now - a.lastCorrectionAt < this.cfg.correctionIntervalMs) return;
    a.lastCorrectionAt = now;
    a.lastAcceptedAt = now;
    a.corrections.push(now);
    while (a.corrections.length > 0 && (a.corrections[0] ?? 0) < now - 60_000) a.corrections.shift();
    this.out.control(a.userId, { t: 'correction', seq, x: a.x, y: a.y, reason });
    if (a.corrections.length > this.cfg.maxCorrectionsPerMinute) this.out.abuse(a.userId);
  }

  private teleport(a: Avatar, x: number, y: number, now: number): void {
    this.place(a, Math.round(x), Math.round(y));
    a.lastAcceptedAt = now;
    a.lastCorrectionAt = now; // inputs em trânsito da posição antiga são descartados em silêncio
    this.out.control(a.userId, { t: 'correction', seq: a.lastAcceptedSeq, x: a.x, y: a.y, reason: 'teleport' });
  }

  private place(a: Avatar, x: number, y: number): void {
    a.x = x;
    a.y = y;
    if (this.grid.upsert(a.netId, x, y)) a.cellDirty = true;
    const z = this.map.zoneAt(x, y);
    if ((z?.key ?? null) !== (a.zone?.key ?? null)) this.setZone(a, z);
  }

  private setZone(a: Avatar, z: PrivateZone | null): void {
    const from = a.zone;
    a.zone = z;
    this.out.zoneChanged(a.userId, from, z);
    this.out.control(a.userId, z ? { t: 'zone', zoneKey: z.key, name: z.name, occupancy: this.occupancy(z), capacity: z.capacity } : { t: 'zone', zoneKey: null });
    // RN-M3-6: Em reunião automático com ≥ 2 pessoas na sala; volta ao sair.
    if (z && this.occupancy(z) >= 2) {
      for (const b of this.byUser.values()) if (b.zone?.key === z.key && b.ghostSince === null && b.status === 'available') this.setAutoStatus(b, 'in_meeting');
    } else if (!z && a.autoStatus === 'in_meeting') {
      this.setAutoStatus(a, null);
    }
  }

  private setAutoStatus(a: Avatar, status: PresenceStatus | null): void {
    if (status === null) {
      if (a.autoStatus === null) return;
      a.autoStatus = null;
      this.applyStatus(a, 'available');
      return;
    }
    if (a.status !== 'available' && a.autoStatus === null) return; // não sobrescreve escolha manual
    a.autoStatus = status;
    this.applyStatus(a, status);
  }

  private applyStatus(a: Avatar, status: PresenceStatus): void {
    if (a.status === status) return;
    a.status = status;
    const msg: ServerMsg = { t: 'entity_meta', netId: a.netId, status };
    this.out.control(a.userId, msg);
    for (const id of a.aoi) {
      const b = this.byNet.get(id);
      if (b && b.ghostSince === null) this.out.control(b.userId, msg);
    }
    this.out.statusChanged(a.userId, status);
  }

  private occupancy(z: PrivateZone): number {
    let n = 0;
    for (const a of this.byUser.values()) if (a.ghostSince === null && a.zone?.key === z.key) n++;
    return n;
  }

  private releaseChair(a: Avatar): void {
    if (a.chairKey && this.chairs.get(a.chairKey) === a.userId) this.chairs.delete(a.chairKey);
    a.chairKey = null;
    a.state = { ...a.state, sitting: false };
  }

  private revive(a: Avatar, now: number): void {
    const wasGhost = a.ghostSince !== null;
    a.ghostSince = null;
    a.state = { ...a.state, ghost: false };
    a.lastAcceptedAt = now;
    a.lastInputAt = now;
    a.hasAcceptedSeq = false; // cliente novo recomeça a sequência
    a.lastSent.clear(); // resume/welcome entregam a AOI completa
    for (const id of a.aoi) {
      const b = this.byNet.get(id);
      if (b) a.lastSent.set(id, stateKey(b.x, b.y, packState(b.state)));
    }
    if (wasGhost && a.zone) {
      if (this.occupancy(a.zone) > a.zone.capacity) {
        // Sala encheu durante a queda: volta pela porta, do lado de fora (M3 edge case).
        const door = this.map.doorOf(a.zone.key);
        const t = this.map.tilePx;
        const spot = door ? nearestFreeTile(this.map, Math.floor(door.x / t), Math.floor(door.y / t), 3, (x, y) => this.map.zoneAt((x + 0.5) * t, (y + 0.5) * t) === null) : null;
        if (spot) this.teleport(a, (spot.tx + 0.5) * t, (spot.ty + 0.5) * t, now);
      } else {
        this.out.zoneChanged(a.userId, null, a.zone);
      }
    }
  }

  private destroy(a: Avatar, now: number): void {
    this.releaseChair(a);
    if (a.zone && a.ghostSince === null) this.out.zoneChanged(a.userId, a.zone, null);
    for (const id of a.aoi) {
      const b = this.byNet.get(id);
      if (!b) continue;
      b.aoi.delete(a.netId);
      b.lastSent.delete(a.netId);
      if (b.ghostSince === null) this.out.control(b.userId, { t: 'entity_leave', netIds: [a.netId] });
    }
    this.grid.remove(a.netId);
    this.byUser.delete(a.userId);
    this.byNet.delete(a.netId);
    this.byResume.delete(a.resumeToken);
    this.audio.forget(a.userId);
    this.releasedNetIds.push({ id: a.netId, at: now });
    this.out.left(a.userId);
  }

  private refreshAoi(a: Avatar, notifySelf = true): void {
    a.cellDirty = false;
    const next = new Set<number>();
    this.grid.forEachInAoi(a.x, a.y, (id) => {
      if (id !== a.netId) next.add(id);
    });
    for (const id of next) {
      if (a.aoi.has(id)) continue;
      const b = this.byNet.get(id);
      if (!b) continue;
      a.aoi.add(id);
      a.lastSent.set(id, stateKey(b.x, b.y, packState(b.state)));
      if (notifySelf && a.ghostSince === null) this.out.control(a.userId, { t: 'entity_enter', entity: this.info(b) });
      if (!b.aoi.has(a.netId)) {
        b.aoi.add(a.netId);
        b.lastSent.set(a.netId, stateKey(a.x, a.y, packState(a.state)));
        if (b.ghostSince === null) this.out.control(b.userId, { t: 'entity_enter', entity: this.info(a) });
      }
    }
    const gone: number[] = [];
    for (const id of a.aoi) {
      if (next.has(id)) continue;
      gone.push(id);
      const b = this.byNet.get(id);
      if (b?.aoi.delete(a.netId)) {
        b.lastSent.delete(a.netId);
        if (b.ghostSince === null) this.out.control(b.userId, { t: 'entity_leave', netIds: [a.netId] });
      }
    }
    for (const id of gone) {
      a.aoi.delete(id);
      a.lastSent.delete(id);
    }
    if (gone.length > 0 && a.ghostSince === null) this.out.control(a.userId, { t: 'entity_leave', netIds: gone });
  }

  private aoiEntities(a: Avatar): EntityInfo[] {
    const out: EntityInfo[] = [this.info(a)];
    for (const id of a.aoi) {
      const b = this.byNet.get(id);
      if (b) out.push(this.info(b));
    }
    return out;
  }

  private info(a: Avatar): EntityInfo {
    return { netId: a.netId, userId: a.userId, displayName: a.displayName, look: a.look, status: a.status, x: a.x, y: a.y, state: packState(a.state) };
  }

  private spawnPoint(last?: { x: number; y: number }): { x: number; y: number } | null {
    const t = this.map.tilePx;
    const occupied = new Set<number>();
    for (const a of this.byUser.values()) occupied.add(Math.floor(a.y / t) * this.map.widthTiles + Math.floor(a.x / t));
    const freeAndEmpty = (x: number, y: number): boolean => !occupied.has(y * this.map.widthTiles + x);
    const canUseZone = (x: number, y: number): boolean => {
      const z = this.map.zoneAt((x + 0.5) * t, (y + 0.5) * t);
      return !z || this.occupancy(z) < z.capacity;
    };
    if (last) {
      const s = nearestFreeTile(this.map, Math.floor(last.x / t), Math.floor(last.y / t), 5, (x, y) => freeAndEmpty(x, y) && canUseZone(x, y));
      if (s) return { x: (s.tx + 0.5) * t, y: (s.ty + 0.5) * t };
    }
    for (const r of this.map.spawns) {
      const cx = Math.floor((r.x + r.w / 2) / t);
      const cy = Math.floor((r.y + r.h / 2) / t);
      const s = nearestFreeTile(this.map, cx, cy, 8, freeAndEmpty) ?? nearestFreeTile(this.map, cx, cy, 8);
      if (s) return { x: (s.tx + 0.5) * t, y: (s.ty + 0.5) * t };
    }
    return null;
  }

  private allocNetId(now: number): number {
    const first = this.releasedNetIds[0];
    if (first && now - first.at >= this.cfg.netIdReuseDelayMs) {
      this.releasedNetIds.shift();
      return first.id;
    }
    if (this.nextNetId > 0xffff) throw new Error('netIds esgotados');
    return this.nextNetId++;
  }
}

