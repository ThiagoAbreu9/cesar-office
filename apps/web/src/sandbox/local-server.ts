/**
 * Servidor realtime rodando DENTRO do navegador, para o demo sem backend.
 * Usa o mesmo RealtimeService e o mesmo domínio do servidor de verdade; só troca
 * o transporte (loopback em memória, com latência simulada) e os adaptadores.
 */
import {
  decodeInput,
  NET,
  Op,
  parseClientControl,
  peekOp,
  type AvatarLook,
  type PresenceStatus,
} from '@cesar-office/protocol';
import { loadWorldMap, type TiledMap } from '@cesar-office/world';
import {
  InMemoryChatStore,
  InMemoryDeskRepository,
  InMemoryOrgBus,
  RealtimeService,
  type ClientConnection,
  type MediaGateway,
  type TicketClaims,
  type TicketVerifier,
} from '@cesar-office/realtime/sandbox';
import type { SocketLike } from '@cesar-office/client';

export const SANDBOX = {
  ORG_ID: '00000000-0000-4000-8000-00000000d3e0',
  SPACE_ID: '00000000-0000-4000-8000-00000000d3e1',
  INSTANCE_ID: 'sandbox_sede',
} as const;

/** Ticket local: só faz sentido dentro deste navegador. */
class LocalTickets implements TicketVerifier {
  private readonly used = new Set<string>();
  sign(c: TicketClaims): string {
    return `local.${crypto.randomUUID()}.${btoa(unescape(encodeURIComponent(JSON.stringify(c))))}`;
  }
  async verify(ticket: string): Promise<TicketClaims | null> {
    const [kind, nonce, body] = ticket.split('.');
    if (kind !== 'local' || !nonce || !body || this.used.has(nonce)) return null;
    this.used.add(nonce);
    return JSON.parse(decodeURIComponent(escape(atob(body)))) as TicketClaims;
  }
}

const noMedia: MediaGateway = {
  enabled: false,
  join: () => Promise.reject(new Error('sem mídia no sandbox')),
  remove: () => Promise.resolve(),
};

const OPEN = 1;
const CLOSED = 3;

/** Lado cliente do loopback: implementa a mesma interface que o WebSocket do navegador. */
class LoopbackSocket implements SocketLike {
  binaryType: BinaryType = 'arraybuffer';
  readyState = 0;
  readonly bufferedAmount = 0;
  onopen: ((ev: Event) => void) | null = null;
  onmessage: ((ev: MessageEvent) => void) | null = null;
  onclose: ((ev: CloseEvent) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;

  constructor(
    private readonly toServer: (data: Uint8Array) => void,
    private readonly onClientClose: () => void,
    private readonly latencyMs: number,
  ) {}

  open(): void {
    this.readyState = OPEN;
    this.onopen?.(new Event('open'));
  }

  send(data: Uint8Array): void {
    if (this.readyState !== OPEN) return;
    const copy = data.slice();
    setTimeout(() => this.toServer(copy), this.latencyMs);
  }

  deliver(data: Uint8Array): void {
    if (this.readyState !== OPEN) return;
    const buf = data.slice().buffer;
    setTimeout(() => this.onmessage?.(new MessageEvent('message', { data: buf })), this.latencyMs);
  }

  close(): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    this.onClientClose();
    setTimeout(() => this.onclose?.(new CloseEvent('close', { code: 1000 })), 0);
  }

  serverClose(code: number): void {
    if (this.readyState === CLOSED) return;
    this.readyState = CLOSED;
    setTimeout(() => this.onclose?.(new CloseEvent('close', { code })), this.latencyMs);
  }
}

export class LocalServer {
  readonly service: RealtimeService;
  readonly map: TiledMap;
  private readonly tickets = new LocalTickets();
  private nextId = 1;
  private timer: number | null = null;

  constructor(map: TiledMap, private readonly latencyMs = 25) {
    this.map = map;
    const world = loadWorldMap(map);
    this.service = new RealtimeService({
      tickets: this.tickets,
      maps: { load: async () => ({ map: world, version: 1, url: 'inline:sede' }) },
      media: noMedia,
      chat: new InMemoryChatStore(),
      bus: new InMemoryOrgBus(),
      desks: new InMemoryDeskRepository(),
      clock: { now: () => Date.now() },
      ids: { uuid: () => crypto.randomUUID(), token: () => crypto.randomUUID() + crypto.randomUUID() },
      log: { info: () => {}, warn: () => {}, error: (m, d) => console.error(m, d) },
    });
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.service.tick(), NET.TICK_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    this.service.shutdown();
  }

  ticket(userId: string, displayName: string, look: AvatarLook, status: PresenceStatus = 'available', lastPosition?: { x: number; y: number }): string {
    return this.tickets.sign({
      userId,
      orgId: SANDBOX.ORG_ID,
      spaceId: SANDBOX.SPACE_ID,
      instanceId: SANDBOX.INSTANCE_ID,
      mapId: 'sede',
      role: 'member',
      displayName,
      look,
      status,
      ...(lastPosition ? { lastPosition } : {}),
    });
  }

  /** Nova "conexão de rede" — o equivalente a `new WebSocket(url)`. */
  connect(): LoopbackSocket {
    const id = this.nextId++;
    let sock: LoopbackSocket | null = null;
    const conn: ClientConnection = {
      id,
      bufferedAmount: 0,
      send: (data) => sock?.deliver(data),
      close: (code) => {
        sock?.serverClose(code);
        this.service.onClose(conn);
      },
    };
    sock = new LoopbackSocket(
      (data) => this.dispatch(conn, data),
      () => this.service.onClose(conn),
      this.latencyMs,
    );
    this.service.onOpen(conn);
    const s = sock;
    setTimeout(() => s.open(), this.latencyMs);
    return s;
  }

  private dispatch(conn: ClientConnection, buf: Uint8Array): void {
    const op = peekOp(buf);
    if (op === Op.Input) {
      try {
        this.service.onInput(conn, decodeInput(buf));
      } catch {
        /* input malformado: ignorado, como no gateway */
      }
      return;
    }
    if (op !== Op.Control) return;
    const parsed = parseClientControl(buf, NET.MAX_CLIENT_FRAME_BYTES);
    if (parsed.ok) void this.service.onControl(conn, parsed.value);
  }
}
