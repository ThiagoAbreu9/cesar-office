/**
 * Sessão de jogo: orquestra conexão, relógio, estado do mundo e o event bus.
 * Não conhece Phaser nem React. A cena Phaser é uma "view" que se acopla a uma sessão pronta.
 *
 * Camada: application (05 §2). Dependências de infraestrutura entram pelo construtor.
 */
import { packState, WORLD, type ClientMsg, type PresenceStatus, type ServerMsg, type ServerMsgOf, type SnapshotFrame } from '@cesar-office/protocol';
import { Connection, type ConnectionDeps } from '../net/connection.ts';
import { ServerClock, TickTimeline } from '../net/server-clock.ts';
import { WorldState } from '../ecs/world-state.ts';
import { Position } from '../ecs/components.ts';
import type { EventBus, Unsubscribe } from '../core/event-bus.ts';
import type { GameEvents } from '../core/game-events.ts';

export interface SessionDeps extends Omit<ConnectionDeps, 'clock'> {
  readonly bus: EventBus<GameEvents>;
}

/** Ganchos que a cena registra para efeitos visuais imediatos. */
export interface SessionViewHooks {
  onCorrection(x: number, y: number): void;
  onTeleport(x: number, y: number): void;
  onResynced(): void;
}

export class GameSession {
  readonly clock: ServerClock;
  readonly world = new WorldState();
  /**
   * Quem está online na org (fora da AOI também). Mantido aqui, e não na UI, porque o estado
   * inicial chega logo após o welcome — antes de qualquer componente se inscrever no bus.
   */
  readonly roster = new Map<string, { displayName: string; status: PresenceStatus }>();
  readonly connection: Connection;
  private readonly timeline = new TickTimeline();
  private welcome: ServerMsgOf<'welcome'> | null = null;
  private view: SessionViewHooks | null = null;
  private readonly unsubs: Unsubscribe[] = [];

  constructor(private readonly deps: SessionDeps) {
    this.clock = new ServerClock(deps.now);
    this.connection = new Connection(
      { ...deps, clock: this.clock },
      {
        onState: (state, attempt) => deps.bus.emit('net:state', { state, attempt }),
        onWelcome: (m) => this.handleWelcome(m),
        onResumed: (m) => this.handleResumed(m),
        onSnapshot: (f) => this.handleSnapshot(f),
        onControl: (m) => this.handleControl(m),
        onRejoinRequired: (reason) => deps.bus.emit('net:rejoin-required', { reason }),
      },
    );
    this.bindUiCommands();
  }

  /** Dados do mapa e posição inicial, disponíveis após o welcome. */
  get welcomeData(): ServerMsgOf<'welcome'> | null {
    return this.welcome;
  }

  start(wsUrl: string, ticket: string): void {
    this.connection.connect(wsUrl, ticket);
  }

  attachView(hooks: SessionViewHooks): void {
    this.view = hooks;
  }

  detachView(): void {
    this.view = null;
  }

  send(msg: ClientMsg): boolean {
    return this.connection.sendControl(msg);
  }

  dispose(): void {
    for (const u of this.unsubs) u();
    this.unsubs.length = 0;
    this.connection.dispose();
    this.world.dispose();
    this.view = null;
  }

  // ───────────────────────────── handlers de rede ─────────────────────────────

  private handleWelcome(m: ServerMsgOf<'welcome'>): void {
    const firstWelcome = this.welcome === null;
    this.welcome = m;
    this.timeline.reset(m.tick, m.serverTime);
    this.world.dispose();
    const self = m.entities.find((e) => e.netId === m.netId);
    this.world.spawnLocal(
      self ?? {
        netId: m.netId,
        userId: m.userId,
        displayName: '',
        look: { body: 0, hair: 0, outfit: 0 },
        status: 'available',
        x: m.self.x,
        y: m.self.y,
        state: 0,
      },
    );
    for (const e of m.entities) if (e.netId !== m.netId) this.world.spawnRemote(e, m.serverTime);
    if (firstWelcome) this.deps.bus.emit('world:ready', { userId: m.userId, instanceId: m.instanceId });
    else {
      this.view?.onTeleport(m.self.x, m.self.y);
      this.view?.onResynced();
    }
  }

  private handleResumed(m: ServerMsgOf<'resumed'>): void {
    const serverTime = this.clock.serverNow();
    this.timeline.reset(m.tick, serverTime);
    this.world.despawnAllRemotes();
    const local = this.world.localEntity;
    for (const e of m.entities) {
      if (local !== null && this.world.entityOf(e.netId) === local) {
        // Servidor manda nossa posição autoritativa: realinha a predição.
        if (Math.hypot((Position.x[local] ?? 0) - e.x, (Position.y[local] ?? 0) - e.y) > WORLD.TILE_PX) {
          this.view?.onTeleport(e.x, e.y);
        }
        continue;
      }
      this.world.spawnRemote(e, serverTime);
    }
    this.view?.onResynced();
  }

  private handleSnapshot(f: SnapshotFrame): void {
    const t = this.timeline.timeOf(f.tick);
    const local = this.world.localEntity;
    for (const e of f.entities) {
      const eid = this.world.entityOf(e.netId);
      if (eid === undefined || eid === local) continue; // entidade desconhecida: entity_enter chega antes
      this.world.bufferOf(eid)?.push({ t, x: e.x, y: e.y, state: packState(e.state) });
    }
  }

  private handleControl(m: ServerMsg): void {
    const bus = this.deps.bus;
    switch (m.t) {
      case 'entity_enter':
        this.world.spawnRemote(m.entity, this.clock.serverNow());
        return;
      case 'entity_leave':
        for (const id of m.netIds) this.world.despawn(id);
        return;
      case 'entity_meta': {
        const eid = this.world.entityOf(m.netId);
        if (eid !== undefined) this.world.updateMeta(eid, m.displayName, m.status);
        return;
      }
      case 'correction':
        if (m.reason === 'teleport') this.view?.onTeleport(m.x, m.y); // "Ir até" autorizado (03 M6)
        else this.view?.onCorrection(m.x, m.y);
        bus.emit('world:correction', { reason: m.reason });
        return;
      case 'presence': {
        const prev = this.roster.get(m.userId);
        if (m.status === 'offline') this.roster.delete(m.userId);
        else this.roster.set(m.userId, { displayName: m.displayName ?? prev?.displayName ?? '', status: m.status });
        bus.emit('presence:changed', { userId: m.userId, status: m.status, ...(m.displayName ? { displayName: m.displayName } : {}) });
        return;
      }
      case 'zone':
        bus.emit('world:zone', m);
        return;
      case 'audible':
        bus.emit('media:audible', { peers: m.peers, bubbleId: m.bubbleId });
        return;
      case 'media_join':
        bus.emit('media:join', m);
        return;
      case 'media_leave':
        bus.emit('media:leave', m);
        return;
      case 'chat':
        bus.emit('chat:message', m);
        return;
      case 'chat_ack':
        bus.emit('chat:ack', m);
        return;
      case 'call_received':
        bus.emit('call:received', m);
        return;
      case 'call_result':
        bus.emit('call:result', m);
        return;
      case 'error':
        bus.emit('error', m);
        return;
      case 'kicked':
        bus.emit('kicked', m);
        return;
      case 'welcome':
      case 'resumed':
      case 'resume_rejected':
      case 'pong':
        return; // tratados pela Connection
    }
  }

  // ───────────────────────────── comandos da UI ─────────────────────────────

  private bindUiCommands(): void {
    const { bus } = this.deps;
    this.unsubs.push(
      bus.on('ui:set-status', ({ status }) => void this.send({ t: 'set_status', status })),
      bus.on('ui:chat-send', ({ channel, body, clientMsgId }) => void this.send({ t: 'chat_send', channel, body, clientMsgId })),
      bus.on('ui:go-to', ({ userId }) => void this.send({ t: 'go_to', targetUserId: userId })),
      bus.on('ui:call', ({ userId }) => void this.send({ t: 'call', targetUserId: userId })),
      bus.on('ui:call-response', ({ callId, accept }) => void this.send({ t: 'call_response', callId, accept })),
      bus.on('ui:interact', ({ objectKey }) => void this.send({ t: 'interact', objectKey })),
    );
  }
}
