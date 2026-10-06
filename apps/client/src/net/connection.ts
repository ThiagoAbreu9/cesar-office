/**
 * Conexão com o servidor realtime: handshake, heartbeat, resume com backoff e despacho de frames.
 * Máquina de estados em 04 §5. Sem dependência de Phaser (testável com socket falso).
 */
import {
  decodeSnapshot,
  encodeControl,
  encodeInput,
  NET,
  Op,
  parseServerControl,
  peekOp,
  PROTOCOL_VERSION,
  type ClientMsg,
  type InputFrame,
  type ServerMsg,
  type ServerMsgOf,
  type SnapshotFrame,
} from '@cesar-office/protocol';
import type { ServerClock } from './server-clock.ts';

export type ConnectionState = 'idle' | 'connecting' | 'handshaking' | 'online' | 'resuming' | 'rejoining' | 'failed' | 'closed';

/** Subconjunto de WebSocket que usamos — permite injetar um falso nos testes. */
export interface SocketLike {
  binaryType: BinaryType;
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: Event) => void) | null;
  onmessage: ((ev: MessageEvent) => void) | null;
  onclose: ((ev: CloseEvent) => void) | null;
  onerror: ((ev: Event) => void) | null;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

export interface ConnectionDeps {
  readonly createSocket: (url: string) => SocketLike;
  readonly clock: ServerClock;
  readonly now: () => number;
  readonly timers: Timers;
  readonly random: () => number;
}

export interface ConnectionHandlers {
  onState(state: ConnectionState, attempt: number): void;
  onWelcome(msg: ServerMsgOf<'welcome'>): void;
  onResumed(msg: ServerMsgOf<'resumed'>): void;
  onSnapshot(frame: SnapshotFrame): void;
  /** Toda mensagem de controle que não é tratada aqui (handshake, pong). */
  onControl(msg: ServerMsg): void;
  /** Resume impossível: a aplicação deve pedir um novo ticket à API. */
  onRejoinRequired(reason: string): void;
}

const OPEN = 1;
const BACKOFF_MS = [500, 1000, 2000, 4000] as const;
/** Acima disto (bytes) não enfileiramos mais inputs: o próximo substitui o anterior. */
const MAX_BUFFERED_BYTES = 64 * 1024;

export class Connection {
  private socket: SocketLike | null = null;
  private state: ConnectionState = 'idle';
  private url = '';
  private ticket = '';
  private resumeToken: string | null = null;
  private lastTick = 0;
  private attempt = 0;
  private resumeStartedAt = 0;
  private lastFrameAt = 0;
  private pingTimer: number | null = null;
  private retryTimer: number | null = null;

  constructor(
    private readonly deps: ConnectionDeps,
    private readonly handlers: ConnectionHandlers,
  ) {}

  get currentState(): ConnectionState {
    return this.state;
  }

  connect(url: string, ticket: string): void {
    this.dispose();
    this.url = url;
    this.ticket = ticket;
    this.resumeToken = null;
    this.attempt = 0;
    this.open();
  }

  sendInput(frame: InputFrame): boolean {
    const s = this.socket;
    if (this.state !== 'online' || !s || s.readyState !== OPEN) return false;
    if (s.bufferedAmount > MAX_BUFFERED_BYTES) return false;
    s.send(encodeInput(frame));
    return true;
  }

  sendControl(msg: ClientMsg): boolean {
    const s = this.socket;
    if (!s || s.readyState !== OPEN) return false;
    if (this.state !== 'online' && msg.t !== 'hello' && msg.t !== 'resume') return false;
    s.send(encodeControl(msg));
    return true;
  }

  /** Encerramento definitivo (troca de mapa, logout, unmount). */
  dispose(): void {
    this.stopTimers();
    if (this.socket) {
      this.detach(this.socket);
      this.socket.close(1000, 'client dispose');
      this.socket = null;
    }
    if (this.state !== 'idle') this.setState('closed');
  }

  // ───────────────────────────── internos ─────────────────────────────

  private open(): void {
    const resuming = this.resumeToken !== null;
    this.setState(resuming ? 'resuming' : 'connecting');
    const s = this.deps.createSocket(this.url);
    s.binaryType = 'arraybuffer';
    s.onopen = () => {
      this.lastFrameAt = this.deps.now();
      if (this.resumeToken) {
        this.sendControl({ t: 'resume', v: PROTOCOL_VERSION, resumeToken: this.resumeToken, lastTick: this.lastTick });
      } else {
        this.setState('handshaking');
        this.sendControl({ t: 'hello', v: PROTOCOL_VERSION, ticket: this.ticket });
      }
    };
    s.onmessage = (ev) => this.onMessage(ev);
    s.onclose = () => this.onDisconnect('close');
    s.onerror = () => {
      /* onclose sempre vem em seguida; tratamos lá */
    };
    this.socket = s;
  }

  private onMessage(ev: MessageEvent): void {
    if (!(ev.data instanceof ArrayBuffer)) return; // protocolo é só binário
    this.lastFrameAt = this.deps.now();
    const buf = new Uint8Array(ev.data);
    const op = peekOp(buf);

    if (op === Op.Snapshot) {
      if (this.state !== 'online') return;
      try {
        const frame = decodeSnapshot(buf);
        this.lastTick = frame.tick;
        this.handlers.onSnapshot(frame);
      } catch {
        // frame corrompido: ignora; o delta por cliente se recupera no próximo tick (04 §2.2)
      }
      return;
    }
    if (op !== Op.Control) return;

    const parsed = parseServerControl(buf);
    if (!parsed.ok) return;
    const msg = parsed.value;

    switch (msg.t) {
      case 'welcome':
        this.resumeToken = msg.resumeToken;
        this.lastTick = msg.tick;
        this.deps.clock.seed(msg.serverTime);
        this.goOnline();
        this.handlers.onWelcome(msg);
        return;
      case 'resumed':
        this.resumeToken = msg.resumeToken;
        this.lastTick = msg.tick;
        this.goOnline();
        this.handlers.onResumed(msg);
        return;
      case 'resume_rejected':
        this.requireRejoin(msg.reason);
        return;
      case 'pong':
        this.deps.clock.onPong(msg.c, msg.s);
        return;
      case 'error':
        if (msg.code === 'unauthorized' || msg.code === 'version_mismatch') {
          this.stopTimers();
          this.setState('failed');
        }
        this.handlers.onControl(msg);
        return;
      case 'kicked':
        this.handlers.onControl(msg);
        if (msg.reason === 'shutdown') this.requireRejoin('shutdown');
        else {
          this.dispose();
          this.setState('failed');
        }
        return;
      default:
        this.handlers.onControl(msg);
    }
  }

  private goOnline(): void {
    this.attempt = 0;
    this.setState('online');
    this.startHeartbeat();
  }

  private startHeartbeat(): void {
    this.stopTimers();
    this.pingTimer = this.deps.timers.setInterval(() => {
      const now = this.deps.now();
      if (now - this.lastFrameAt > NET.DEAD_CONNECTION_MS) {
        this.socket?.close(4000, 'heartbeat timeout');
        this.onDisconnect('timeout');
        return;
      }
      this.sendControl({ t: 'ping', c: now });
    }, NET.PING_INTERVAL_MS);
  }

  private onDisconnect(_why: 'close' | 'timeout'): void {
    if (this.socket) {
      this.detach(this.socket);
      this.socket = null;
    }
    this.stopTimers();
    if (this.state === 'failed' || this.state === 'closed' || this.state === 'rejoining') return;

    if (!this.resumeToken) {
      // Caiu antes do welcome: novo ticket necessário (o anterior é de uso único).
      this.requireRejoin('handshake_failed');
      return;
    }
    if (this.state === 'online') this.resumeStartedAt = this.deps.now();
    if (this.deps.now() - this.resumeStartedAt > NET.RESUME_WINDOW_MS) {
      this.requireRejoin('expired');
      return;
    }
    const base = BACKOFF_MS[Math.min(this.attempt, BACKOFF_MS.length - 1)] ?? 4000;
    const jitter = base * 0.2 * (this.deps.random() * 2 - 1);
    this.attempt++;
    this.setState('resuming');
    this.retryTimer = this.deps.timers.setTimeout(() => this.open(), Math.round(base + jitter));
  }

  private requireRejoin(reason: string): void {
    this.stopTimers();
    this.resumeToken = null;
    if (this.socket) {
      this.detach(this.socket);
      this.socket.close(1000, 'rejoin');
      this.socket = null;
    }
    this.setState('rejoining');
    this.handlers.onRejoinRequired(reason);
  }

  private stopTimers(): void {
    if (this.pingTimer !== null) this.deps.timers.clearInterval(this.pingTimer);
    if (this.retryTimer !== null) this.deps.timers.clearTimeout(this.retryTimer);
    this.pingTimer = null;
    this.retryTimer = null;
  }

  private detach(s: SocketLike): void {
    s.onopen = null;
    s.onmessage = null;
    s.onclose = null;
    s.onerror = null;
  }

  private setState(next: ConnectionState): void {
    if (this.state === next) return;
    this.state = next;
    this.handlers.onState(next, this.attempt);
  }
}
