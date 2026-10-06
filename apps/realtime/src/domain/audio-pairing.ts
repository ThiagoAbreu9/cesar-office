/**
 * Cálculo de quem ouve quem (03-mecanicas M2/M3, 04-multiplayer §7).
 *
 * Domínio puro: sem rede, sem relógio global. Rodado pela instância a cada BUBBLE_RECALC_MS.
 *
 * Área aberta:
 *   - par novo exige dist ≤ ENTER por DWELL ms contínuos, linha de visão e ninguém em DND;
 *   - par existente se mantém enquanto dist ≤ EXIT (histerese);
 *   - grau máximo MAX_AUDIBLE por pessoa; seleção gulosa, pares existentes primeiro,
 *     depois por distância — garante simetria (pares, não listas por ouvinte).
 * Zona privada: todos da mesma zona se ouvem, volume 1, sem limite de grau.
 */
import { WORLD } from '@cesar-office/protocol';
import { SpatialGrid } from './spatial-grid.ts';

export interface Participant {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  /** null = área aberta. */
  readonly zoneKey: string | null;
  readonly dnd: boolean;
}

export interface AudioParams {
  readonly tilePx: number;
  readonly enterTiles: number;
  readonly exitTiles: number;
  readonly dwellMs: number;
  readonly maxAudible: number;
  readonly fullVolumeTiles: number;
  readonly minVolume: number;
}

export const DEFAULT_AUDIO_PARAMS: AudioParams = {
  tilePx: WORLD.TILE_PX,
  enterTiles: WORLD.AUDIO_ENTER_TILES,
  exitTiles: WORLD.AUDIO_EXIT_TILES,
  dwellMs: WORLD.AUDIO_ENTER_DWELL_MS,
  maxAudible: WORLD.MAX_AUDIBLE_OPEN,
  fullVolumeTiles: 1.5,
  minVolume: 0.25,
};

/** Linha de visão entre dois pontos em px (raycast na grade de colisão). Injetado pela infraestrutura do mapa. */
export type LineOfSight = (ax: number, ay: number, bx: number, by: number) => boolean;

export interface AudioResult {
  /** userId → (peerId → volume 0..1). */
  readonly audible: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** userId → id da bolha (componente conexo) ou da zona. Ausente = sozinho. */
  readonly bubbleOf: ReadonlyMap<string, string>;
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

export class AudioPairing {
  /** Pares abertos ativos. */
  private active = new Set<string>();
  /** Par candidato → instante em que entrou no raio de entrada. */
  private readonly dwellSince = new Map<string, number>();

  constructor(
    private readonly params: AudioParams = DEFAULT_AUDIO_PARAMS,
    private readonly lineOfSight: LineOfSight = () => true,
  ) {
    if (params.exitTiles < params.enterTiles) throw new RangeError('exitTiles deve ser ≥ enterTiles');
  }

  volumeAt(distPx: number): number {
    const { tilePx, fullVolumeTiles, exitTiles, minVolume } = this.params;
    const d = distPx / tilePx;
    if (d <= fullVolumeTiles) return 1;
    if (d >= exitTiles) return minVolume;
    const t = (d - fullVolumeTiles) / (exitTiles - fullVolumeTiles);
    return 1 - t * (1 - minVolume);
  }

  compute(participants: readonly Participant[], nowMs: number): AudioResult {
    const p = this.params;
    const enterPx = p.enterTiles * p.tilePx;
    const exitPx = p.exitTiles * p.tilePx;

    const byId = new Map<string, Participant>();
    const grid = new SpatialGrid<string>(exitPx);
    const zones = new Map<string, string[]>();
    for (const part of participants) {
      byId.set(part.id, part);
      if (part.zoneKey === null) grid.upsert(part.id, part.x, part.y);
      else {
        const list = zones.get(part.zoneKey) ?? [];
        list.push(part.id);
        zones.set(part.zoneKey, list);
      }
    }

    // 1) Candidatos em área aberta.
    interface Candidate { readonly a: string; readonly b: string; readonly dist: number; readonly existing: boolean }
    const candidates: Candidate[] = [];
    const seenDwell = new Set<string>();

    for (const a of participants) {
      if (a.zoneKey !== null) continue;
      grid.forEachNear(a.x, a.y, exitPx, (bid) => {
        if (bid <= a.id) return; // cada par uma vez
        const b = byId.get(bid);
        if (!b) return;
        const key = pairKey(a.id, b.id);
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const eligible = !a.dnd && !b.dnd && this.lineOfSight(a.x, a.y, b.x, b.y);
        if (!eligible) return;

        if (this.active.has(key)) {
          if (dist <= exitPx) candidates.push({ a: a.id, b: b.id, dist, existing: true });
          return;
        }
        if (dist <= enterPx) {
          seenDwell.add(key);
          const since = this.dwellSince.get(key) ?? nowMs;
          this.dwellSince.set(key, since);
          if (nowMs - since >= p.dwellMs) candidates.push({ a: a.id, b: b.id, dist, existing: false });
        }
      });
    }
    // Quem saiu do raio de entrada antes do dwell perde a contagem.
    for (const key of this.dwellSince.keys()) if (!seenDwell.has(key)) this.dwellSince.delete(key);

    // 2) Seleção gulosa simétrica com limite de grau.
    candidates.sort((x, y) => (x.existing === y.existing ? x.dist - y.dist : x.existing ? -1 : 1));
    const degree = new Map<string, number>();
    const nextActive = new Set<string>();
    const audible = new Map<string, Map<string, number>>();
    const link = (u: string, v: string, vol: number): void => {
      let m = audible.get(u);
      if (!m) {
        m = new Map<string, number>();
        audible.set(u, m);
      }
      m.set(v, vol);
    };

    const uf = new UnionFind();
    for (const c of candidates) {
      const da = degree.get(c.a) ?? 0;
      const db = degree.get(c.b) ?? 0;
      if (da >= p.maxAudible || db >= p.maxAudible) continue;
      degree.set(c.a, da + 1);
      degree.set(c.b, db + 1);
      const key = pairKey(c.a, c.b);
      nextActive.add(key);
      this.dwellSince.delete(key);
      const vol = this.volumeAt(c.dist);
      link(c.a, c.b, vol);
      link(c.b, c.a, vol);
      uf.union(c.a, c.b);
    }
    this.active = nextActive;

    // 3) Bolhas abertas = componentes conexos; id estável = menor userId do componente.
    const bubbleOf = new Map<string, string>();
    for (const id of audible.keys()) bubbleOf.set(id, `b:${uf.find(id)}`);

    // 4) Zonas privadas: todos com todos, volume 1.
    for (const [zoneKey, members] of zones) {
      if (members.length < 2) continue;
      for (const u of members) {
        bubbleOf.set(u, `z:${zoneKey}`);
        for (const v of members) if (u !== v) link(u, v, 1);
      }
    }

    return { audible, bubbleOf };
  }

  /** Remove estado de um usuário que saiu (evita par "fantasma" na volta). */
  forget(id: string): void {
    for (const key of this.active) if (key.startsWith(`${id}|`) || key.endsWith(`|${id}`)) this.active.delete(key);
    for (const key of this.dwellSince.keys()) if (key.startsWith(`${id}|`) || key.endsWith(`|${id}`)) this.dwellSince.delete(key);
  }
}

/** Union-find com raiz = menor id (determinístico para ids de bolha estáveis). */
class UnionFind {
  private readonly parent = new Map<string, string>();

  find(x: string): string {
    let root = this.parent.get(x) ?? x;
    while (root !== (this.parent.get(root) ?? root)) root = this.parent.get(root) ?? root;
    // compressão de caminho
    let cur = x;
    while (cur !== root) {
      const next = this.parent.get(cur) ?? cur;
      this.parent.set(cur, root);
      cur = next;
    }
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (ra < rb) this.parent.set(rb, ra);
    else this.parent.set(ra, rb);
  }
}
