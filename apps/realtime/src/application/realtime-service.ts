/**
 * Casos de uso do servidor realtime: handshake, resume, movimento, chat, presença, chamados,
 * mesas e mídia (somente áudio). Orquestra MapInstances e portas; não conhece `ws` nem LiveKit.
 */
import {
  encodeControl,
  encodeSnapshot,
  type ClientMsg,
  type InputFrame,
  type ServerMsg,
  type ServerMsgOf,
  type SnapshotFrame,
} from '@cesar-office/protocol';
import type { PrivateZone } from '@cesar-office/world';
import { MapInstance, DEFAULT_INSTANCE_CONFIG, type InstanceConfig, type InstanceOutput } from '../domain/map-instance.ts';
import type { ChatStore, Clock, DeskRepository, IdGenerator, Logger, MapRepository, MediaGateway, OrgBus, TicketVerifier } from './ports.ts';

/** Conexão vista pela aplicação. Implementada pelo gateway WebSocket. */
export interface ClientConnection {
  readonly id: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

/** Códigos de fechamento (09 §2.5). */
export const CloseCode = {
  Normal: 1000,
  BadTicket: 4001,
  VersionMismatch: 4002,
  Abuse: 4003,
  Replaced: 4004,
  Shutdown: 4010,
} as const;

export interface ServiceDeps {
  readonly tickets: TicketVerifier;
  readonly maps: MapRepository;
  readonly media: MediaGateway;
  readonly chat: ChatStore;
  readonly bus: OrgBus;
  readonly desks: DeskRepository;
  readonly clock: Clock;
  readonly ids: IdGenerator;
  readonly log: Logger;
  readonly instanceConfig?: Partial<InstanceConfig>;
  /** Acima disto (bytes enfileirados), snapshots são pulados (04 §9). */
  readonly backpressureBytes?: number;
}

interface Session {
  readonly conn: ClientConnection;
  state: 'pending' | 'online' | 'closed';
  userId?: string;
  orgId?: string;
  instance?: Hosted;
}

interface Hosted {
  readonly instance: MapInstance;
  readonly orgId: string;
  readonly mapId: string;
  readonly mapUrl: string;
  readonly mapVersion: number;
}

interface PendingCall {
  readonly from: string;
  readonly to: string;
  readonly expiresAt: number;
  readonly instance: Hosted;
}

const CALL_TTL_MS = 20_000; // P-13
const CALL_COOLDOWN_MS = 30_000; // P-12

export class RealtimeService {
  private readonly sessions = new Map<number, Session>();
  private readonly byUser = new Map<string, Session>();
  private readonly instances = new Map<string, Hosted>();
  private readonly loading = new Map<string, Promise<Hosted>>();
  private readonly orgSubs = new Map<string, { count: number; unsubscribe: () => void }>();
  private readonly calls = new Map<string, PendingCall>();
  private readonly callCooldown = new Map<string, number>();
  private readonly tickDurations: number[] = [];
  private readonly cfg: InstanceConfig;
  private readonly backpressureBytes: number;

  constructor(private readonly d: ServiceDeps) {
    this.cfg = { ...DEFAULT_INSTANCE_CONFIG, ...d.instanceConfig };
    this.backpressureBytes = d.backpressureBytes ?? 64 * 1024;
  }

  // ───────────────────────────── eventos do gateway ─────────────────────────────

  onOpen(conn: ClientConnection): void {
    this.sessions.set(conn.id, { conn, state: 'pending' });
  }

  onClose(conn: ClientConnection): void {
    const s = this.sessions.get(conn.id);
    if (!s) return;
    this.sessions.delete(conn.id);
    const wasOnline = s.state === 'online';
    s.state = 'closed';
    if (!s.userId || this.byUser.get(s.userId) !== s) return;
    this.byUser.delete(s.userId);
    if (s.orgId) this.releaseOrg(s.orgId);
    if (wasOnline && s.instance) s.instance.instance.disconnect(s.userId, this.d.clock.now());
  }

  onInput(conn: ClientConnection, frame: InputFrame): void {
    const s = this.sessions.get(conn.id);
    if (s?.state !== 'online' || !s.userId || !s.instance) return;
    s.instance.instance.applyInput(s.userId, frame, this.d.clock.now());
  }

  async onControl(conn: ClientConnection, msg: ClientMsg): Promise<void> {
    const s = this.sessions.get(conn.id);
    if (!s || s.state === 'closed') return;

    if (s.state === 'pending') {
      if (msg.t === 'hello') return this.hello(s, msg.ticket);
      if (msg.t === 'resume') return this.resume(s, msg.resumeToken);
      return this.fail(s, 'unauthorized', 'Primeiro frame deve ser hello ou resume', CloseCode.BadTicket);
    }

    const userId = s.userId;
    const h = s.instance;
    if (!userId || !h) return;
    const now = this.d.clock.now();

    switch (msg.t) {
      case 'hello':
      case 'resume':
        return this.send(s, { t: 'error', code: 'bad_request', message: 'Sessão já iniciada', ref: msg.t });
      case 'ping':
        return this.send(s, { t: 'pong', c: msg.c, s: now });
      case 'set_status':
        h.instance.setStatus(userId, msg.status);
        return;
      case 'chat_send':
        return this.chat(s, userId, h, msg.channel, msg.clientMsgId, msg.body);
      case 'interact': {
        const r = h.instance.interact(userId, msg.objectKey, now);
        if (r !== 'ok') this.send(s, { t: 'error', code: r === 'not_found' ? 'not_found' : 'forbidden', message: r, ref: 'interact' });
        return;
      }
      case 'claim_desk':
        return this.claimDesk(s, userId, h, msg.deskKey);
      case 'go_to': {
        const r = h.instance.goTo(userId, msg.targetUserId, now);
        if (r !== 'ok') this.send(s, { t: 'error', code: 'not_found', message: r, ref: 'go_to' });
        return;
      }
      case 'call':
        return this.call(s, userId, h, msg.targetUserId, now);
      case 'call_response':
        return this.callResponse(s, userId, msg.callId, msg.accept, now);
    }
  }

  /** Um tick de todas as instâncias deste nó. Retorna a duração (ms) para métricas. */
  tick(): number {
    const t0 = performance.now();
    const now = this.d.clock.now();
    for (const h of this.instances.values()) h.instance.step(now);
    for (const [id, c] of this.calls) {
      if (c.expiresAt > now) continue;
      this.calls.delete(id);
      this.sendTo(c.from, { t: 'call_result', callId: id, accepted: false });
    }
    const dt = performance.now() - t0;
    this.tickDurations.push(dt);
    if (this.tickDurations.length > 600) this.tickDurations.shift();
    return dt;
  }

  metrics(): { sessions: number; instances: { id: string; ccu: number }[]; tickP50: number; tickP99: number } {
    const sorted = [...this.tickDurations].sort((a, b) => a - b);
    const pct = (p: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
    return {
      sessions: this.byUser.size,
      instances: [...this.instances.entries()].map(([id, h]) => ({ id, ccu: h.instance.ccu })),
      tickP50: pct(0.5),
      tickP99: pct(0.99),
    };
  }

  /** Desligamento gracioso (04 §5): avisa e fecha; clientes refazem join em outro nó. */
  shutdown(): void {
    for (const s of this.sessions.values()) {
      this.send(s, { t: 'kicked', reason: 'shutdown' });
      s.conn.close(CloseCode.Shutdown, 'shutdown');
    }
    for (const sub of this.orgSubs.values()) sub.unsubscribe();
    this.orgSubs.clear();
  }

  // ───────────────────────────── handshake ─────────────────────────────

  private async hello(s: Session, ticket: string): Promise<void> {
    const claims = await this.d.tickets.verify(ticket);
    if (!claims) return this.fail(s, 'unauthorized', 'Ticket inválido ou expirado', CloseCode.BadTicket);

    let h: Hosted;
    try {
      h = await this.hostedFor(claims.instanceId, claims.orgId, claims.mapId);
    } catch (e) {
      this.d.log.error('falha ao carregar instância', { instanceId: claims.instanceId, error: String(e) });
      return this.fail(s, 'internal', 'Instância indisponível', CloseCode.Shutdown);
    }
    if (h.orgId !== claims.orgId) return this.fail(s, 'forbidden', 'Instância de outra organização', CloseCode.BadTicket);
    if (s.state !== 'pending') return; // socket fechou durante o await

    const now = this.d.clock.now();
    const r = h.instance.join(
      {
        userId: claims.userId,
        displayName: claims.displayName,
        look: claims.look,
        status: claims.status,
        ...(claims.lastPosition ? { lastPosition: claims.lastPosition } : {}),
      },
      now,
    );
    if (!r.ok) return this.fail(s, 'forbidden', r.reason === 'full' ? 'Instância lotada' : 'Sem local de entrada', CloseCode.Normal);

    this.bind(s, claims.userId, claims.orgId, h);
    this.send(s, {
      t: 'welcome',
      netId: r.netId,
      userId: claims.userId,
      instanceId: claims.instanceId,
      resumeToken: r.resumeToken,
      serverTime: now,
      tick: h.instance.tick,
      map: { mapId: h.mapId, version: h.mapVersion, url: h.mapUrl },
      self: { x: r.x, y: r.y },
      entities: r.entities,
    });
    await this.announceZoneAndMedia(s, claims.userId, h);
    this.sendRoster(s, claims.orgId);
    this.d.bus.publishPresence(claims.orgId, claims.userId, h.instance.statusOf(claims.userId) ?? claims.status, claims.displayName);
  }

  private async resume(s: Session, token: string): Promise<void> {
    const now = this.d.clock.now();
    for (const h of this.instances.values()) {
      const r = h.instance.resume(token, now);
      if (!r) continue;
      this.bind(s, r.userId, h.orgId, h);
      this.send(s, { t: 'resumed', tick: h.instance.tick, entities: r.entities, resumeToken: r.resumeToken });
      this.sendRoster(s, h.orgId);
      await this.announceZoneAndMedia(s, r.userId, h);
      return;
    }
    this.send(s, { t: 'resume_rejected', reason: 'expired' });
    s.state = 'closed';
    s.conn.close(CloseCode.Normal, 'resume rejected');
  }

  private bind(s: Session, userId: string, orgId: string, h: Hosted): void {
    const previous = this.byUser.get(userId);
    if (previous && previous !== s) {
      // Nova aba assume o avatar; a antiga é avisada e fechada (A4).
      this.send(previous, { t: 'kicked', reason: 'replaced_by_new_tab' });
      previous.state = 'closed';
      previous.conn.close(CloseCode.Replaced, 'replaced');
      this.sessions.delete(previous.conn.id);
      if (previous.orgId) this.releaseOrg(previous.orgId);
    }
    this.ensureOrgSubscription(orgId);
    s.state = 'online';
    s.userId = userId;
    s.orgId = orgId;
    s.instance = h;
    this.byUser.set(userId, s);
  }

  /**
   * Estado inicial da lista de pessoas: quem está online na org NESTE nó.
   * Com vários nós (V1), vem do hash `presence:org:{id}` no Redis (04 §6).
   */
  private sendRoster(s: Session, orgId: string): void {
    for (const other of this.byUser.values()) {
      if (other === s || other.orgId !== orgId || other.state !== 'online' || !other.userId || !other.instance) continue;
      const status = other.instance.instance.statusOf(other.userId);
      if (!status) continue;
      const displayName = other.instance.instance.displayNameOf(other.userId);
      this.send(s, { t: 'presence', userId: other.userId, status, ...(displayName ? { displayName } : {}) });
    }
  }

  private async announceZoneAndMedia(s: Session, userId: string, h: Hosted): Promise<void> {
    const z = h.instance.zoneOf(userId);
    this.send(s, z ? { t: 'zone', zoneKey: z.key, name: z.name, occupancy: h.instance.occupancyOf(z), capacity: z.capacity } : { t: 'zone', zoneKey: null });
    await this.joinMedia(userId, h, z);
  }

  // ───────────────────────────── mídia (somente áudio) ─────────────────────────────

  static openRoom(instanceId: string): string {
    return `${instanceId}.open`;
  }

  static zoneRoom(instanceId: string, zoneKey: string): string {
    return `${instanceId}.zone.${zoneKey}`;
  }

  private async joinMedia(userId: string, h: Hosted, zone: PrivateZone | null): Promise<void> {
    if (!this.d.media.enabled) return;
    const name = h.instance.displayNameOf(userId) ?? userId;
    const id = h.instance.instanceId;
    try {
      const msg = zone
        ? await this.d.media.join(RealtimeService.zoneRoom(id, zone.key), userId, name, 'zone')
        : await this.d.media.join(RealtimeService.openRoom(id), userId, name, 'open');
      this.sendTo(userId, msg);
    } catch (e) {
      this.d.log.warn('falha ao emitir token de mídia', { userId, error: String(e) });
    }
  }

  private onZoneChanged(h: Hosted, userId: string, from: PrivateZone | null, to: PrivateZone | null): void {
    if ((from?.key ?? null) === (to?.key ?? null)) return;
    const id = h.instance.instanceId;
    // Um cliente fica em UMA sala de mídia por vez: aberta OU a da zona (04 §8.2).
    if (from) {
      const room = RealtimeService.zoneRoom(id, from.key);
      this.sendTo(userId, { t: 'media_leave', room });
      if (this.d.media.enabled) this.d.media.remove(room, userId).catch((e: unknown) => this.d.log.warn('removeParticipant falhou', { room, userId, error: String(e) }));
    } else {
      this.sendTo(userId, { t: 'media_leave', room: RealtimeService.openRoom(id) });
    }
    if (this.byUser.get(userId)?.state === 'online') void this.joinMedia(userId, h, to);
  }

  // ───────────────────────────── chat ─────────────────────────────

  private async chat(s: Session, userId: string, h: Hosted, channel: 'here' | 'global', clientMsgId: string, body: string): Promise<void> {
    const now = this.d.clock.now();
    const audience = channel === 'here' ? h.instance.hereAudience(userId) : null;
    const persistentChannel = channel === 'global' ? 'global' : audience?.channel ?? null;
    const candidate = { id: this.d.ids.uuid(), orgId: h.orgId, channel: persistentChannel ?? 'bubble', senderId: userId, body, clientMsgId, at: now };

    const prior = await this.d.chat.claim(userId, clientMsgId, candidate);
    if (prior) return this.send(s, { t: 'chat_ack', clientMsgId, id: prior.id, at: prior.at });
    if (persistentChannel) await this.d.chat.persist(candidate);

    this.send(s, { t: 'chat_ack', clientMsgId, id: candidate.id, at: candidate.at });
    const msg: ServerMsgOf<'chat'> = { t: 'chat', id: candidate.id, channel, fromUserId: userId, fromName: h.instance.displayNameOf(userId) ?? '', body, at: now };
    if (channel === 'global') this.d.bus.publishChat(h.orgId, msg);
    else for (const member of audience?.members ?? []) this.sendTo(member, msg);
  }

  // ───────────────────────────── mesas e chamados ─────────────────────────────

  private async claimDesk(s: Session, userId: string, h: Hosted, deskKey: string): Promise<void> {
    const chair = h.instance.chairOf(userId);
    if (chair?.deskKey !== deskKey) return this.send(s, { t: 'error', code: 'forbidden', message: 'Sente-se na mesa para reivindicá-la', ref: 'claim_desk' });
    const ok = await this.d.desks.claim(h.orgId, h.mapId, deskKey, userId);
    if (!ok) this.send(s, { t: 'error', code: 'forbidden', message: 'Mesa já tem dono', ref: 'claim_desk' });
  }

  private call(s: Session, from: string, h: Hosted, to: string, now: number): void {
    const target = this.byUser.get(to);
    if (!target || target.instance !== h || from === to) return this.send(s, { t: 'error', code: 'not_found', message: 'Pessoa não está neste escritório', ref: 'call' });
    if (h.instance.statusOf(to) === 'dnd') return this.send(s, { t: 'error', code: 'forbidden', message: 'Pessoa em Não perturbe', ref: 'call' });
    const key = `${from}:${to}`;
    if (now - (this.callCooldown.get(key) ?? -Infinity) < CALL_COOLDOWN_MS) return this.send(s, { t: 'error', code: 'rate_limited', message: 'Aguarde para chamar de novo', ref: 'call' });
    this.callCooldown.set(key, now);
    const callId = this.d.ids.uuid();
    this.calls.set(callId, { from, to, expiresAt: now + CALL_TTL_MS, instance: h });
    this.sendTo(to, { t: 'call_received', callId, fromUserId: from, fromName: h.instance.displayNameOf(from) ?? '', expiresAt: now + CALL_TTL_MS });
  }

  private callResponse(s: Session, userId: string, callId: string, accept: boolean, now: number): void {
    const c = this.calls.get(callId);
    if (!c || c.to !== userId) return this.send(s, { t: 'error', code: 'not_found', message: 'Chamado expirado', ref: 'call_response' });
    this.calls.delete(callId);
    this.sendTo(c.from, { t: 'call_result', callId, accepted: accept });
    if (accept) c.instance.instance.goTo(userId, c.from, now); // aceitar = ir até quem chamou (M6)
  }

  // ───────────────────────────── instâncias e org ─────────────────────────────

  private async hostedFor(instanceId: string, orgId: string, mapId: string): Promise<Hosted> {
    const existing = this.instances.get(instanceId);
    if (existing) return existing;
    let p = this.loading.get(instanceId);
    if (!p) {
      p = this.d.maps.load(mapId).then((loaded) => {
        const holder: { h?: Hosted } = {};
        const out = this.outputFor(() => holder.h);
        const instance = new MapInstance(instanceId, mapId, loaded.map, out, () => this.d.ids.token(), this.cfg);
        const h: Hosted = { instance, orgId, mapId, mapUrl: loaded.url, mapVersion: loaded.version };
        holder.h = h;
        this.instances.set(instanceId, h);
        this.d.log.info('instância criada', { instanceId, orgId, mapId });
        return h;
      });
      this.loading.set(instanceId, p);
      p.finally(() => this.loading.delete(instanceId)).catch(() => undefined);
    }
    return p;
  }

  private outputFor(hosted: () => Hosted | undefined): InstanceOutput {
    return {
      control: (userId, msg) => this.sendTo(userId, msg),
      snapshot: (userId, frame) => this.sendSnapshot(userId, frame),
      zoneChanged: (userId, from, to) => {
        const h = hosted();
        if (h) this.onZoneChanged(h, userId, from, to);
      },
      statusChanged: (userId, status) => {
        const h = hosted();
        if (h) this.d.bus.publishPresence(h.orgId, userId, status, h.instance.displayNameOf(userId));
      },
      abuse: (userId) => {
        const s = this.byUser.get(userId);
        if (!s) return;
        this.d.log.warn('abuso detectado (correções em excesso)', { userId });
        this.send(s, { t: 'kicked', reason: 'abuse' });
        s.conn.close(CloseCode.Abuse, 'abuse');
      },
      left: (userId) => {
        const h = hosted();
        if (h) this.d.bus.publishPresence(h.orgId, userId, 'offline');
      },
    };
  }

  private ensureOrgSubscription(orgId: string): void {
    const sub = this.orgSubs.get(orgId);
    if (sub) {
      sub.count++;
      return;
    }
    const unsubscribe = this.d.bus.subscribe(orgId, {
      presence: (userId, status, displayName) => this.broadcastOrg(orgId, { t: 'presence', userId, status, ...(displayName ? { displayName } : {}) }),
      chat: (msg) => this.broadcastOrg(orgId, msg),
    });
    this.orgSubs.set(orgId, { count: 1, unsubscribe });
  }

  private releaseOrg(orgId: string): void {
    const sub = this.orgSubs.get(orgId);
    if (!sub) return;
    if (--sub.count > 0) return;
    sub.unsubscribe();
    this.orgSubs.delete(orgId);
  }

  private broadcastOrg(orgId: string, msg: ServerMsg): void {
    const frame = encodeControl(msg); // codifica uma vez para todos
    for (const s of this.byUser.values()) if (s.orgId === orgId && s.state === 'online') s.conn.send(frame);
  }

  // ───────────────────────────── envio ─────────────────────────────

  private sendTo(userId: string, msg: ServerMsg): void {
    const s = this.byUser.get(userId);
    if (s && s.state !== 'closed') this.send(s, msg);
  }

  private send(s: Session, msg: ServerMsg): void {
    s.conn.send(encodeControl(msg));
  }

  private sendSnapshot(userId: string, frame: SnapshotFrame): boolean {
    const s = this.byUser.get(userId);
    if (!s || s.state !== 'online') return false;
    if (s.conn.bufferedAmount > this.backpressureBytes) return false;
    s.conn.send(encodeSnapshot(frame));
    return true;
  }

  private fail(s: Session, code: ServerMsgOf<'error'>['code'], message: string, close: number): void {
    this.send(s, { t: 'error', code, message });
    s.state = 'closed';
    s.conn.close(close, message);
  }
}

