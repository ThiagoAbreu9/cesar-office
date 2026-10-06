/**
 * Gateway WebSocket + HTTP (health/metrics) + loop de tick.
 * Responsável por: origem permitida, tamanho de frame, rate limit, decodificação e despacho.
 * Nenhuma regra de negócio aqui.
 */
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { decodeInput, NET, Op, parseClientControl, peekOp, RATE, type ClientMsg } from '@cesar-office/protocol';
import { CloseCode, type ClientConnection, type RealtimeService } from '../application/realtime-service.ts';
import type { Logger } from '../application/ports.ts';
import { TokenBucket } from './rate-limiter.ts';

export interface GatewayOptions {
  readonly port: number;
  readonly host?: string;
  /** Origens permitidas no upgrade (proteção contra CSWSH). Vazio = qualquer (só dev). */
  readonly allowedOrigins: readonly string[];
  readonly tickMs?: number;
  readonly path?: string;
  /** Rotas HTTP extras (mapas, modo demo). Retorna true se tratou. */
  readonly http?: (req: IncomingMessage, res: import('node:http').ServerResponse) => boolean;
}

const ACTION_TYPES: ReadonlySet<ClientMsg['t']> = new Set(['set_status', 'interact', 'claim_desk', 'go_to', 'call', 'call_response']);
const MAX_VIOLATIONS_PER_MIN = 50;

interface ConnState {
  readonly conn: ClientConnection;
  readonly input: TokenBucket;
  readonly chat: TokenBucket;
  readonly actions: TokenBucket;
  violations: number[];
}

export class Gateway {
  private readonly http: Server;
  private readonly wss: WebSocketServer;
  private nextId = 1;
  private timer: NodeJS.Timeout | null = null;
  private nextTickAt = 0;
  private readonly states = new Map<WebSocket, ConnState>();

  constructor(
    private readonly service: RealtimeService,
    private readonly opts: GatewayOptions,
    private readonly log: Logger,
  ) {
    this.http = createServer((req, res) => {
      if (opts.http?.(req, res)) return;
      if (req.url === '/healthz') {
        res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
        return;
      }
      if (req.url === '/metrics') {
        res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(this.service.metrics()));
        return;
      }
      res.writeHead(404).end();
    });
    this.wss = new WebSocketServer({
      server: this.http,
      path: opts.path ?? '/ws',
      maxPayload: NET.MAX_CLIENT_FRAME_BYTES,
      perMessageDeflate: false, // frames já são compactos; deflate custa CPU por conexão
      verifyClient: (info: { origin: string; req: IncomingMessage }) => this.originAllowed(info.origin),
    });
    this.wss.on('connection', (ws) => this.onConnection(ws));
  }

  listen(): Promise<{ port: number }> {
    return new Promise((resolve) => {
      this.http.listen(this.opts.port, this.opts.host ?? '0.0.0.0', () => {
        const addr = this.http.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.opts.port;
        this.startTicking();
        this.log.info('realtime ouvindo', { port });
        resolve({ port });
      });
    });
  }

  async close(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.service.shutdown();
    for (const ws of this.wss.clients) ws.terminate();
    await new Promise<void>((r) => this.wss.close(() => r()));
    await new Promise<void>((r) => this.http.close(() => r()));
  }

  // ───────────────────────────── conexões ─────────────────────────────

  private originAllowed(origin: string): boolean {
    if (this.opts.allowedOrigins.length === 0) return true;
    return this.opts.allowedOrigins.includes(origin);
  }

  private onConnection(ws: WebSocket): void {
    const now = Date.now();
    const id = this.nextId++;
    const conn: ClientConnection = {
      id,
      get bufferedAmount() {
        return ws.bufferedAmount;
      },
      send: (data) => {
        if (ws.readyState === ws.OPEN) ws.send(data);
      },
      close: (code, reason) => ws.close(code, reason.slice(0, 120)),
    };
    const st: ConnState = {
      conn,
      input: new TokenBucket(RATE.INPUT_PER_S, RATE.INPUT_PER_S, now),
      chat: new TokenBucket(RATE.CHAT_PER_S, RATE.CHAT_BURST, now),
      actions: new TokenBucket(RATE.ACTIONS_PER_S, RATE.ACTIONS_PER_S, now),
      violations: [],
    };
    this.states.set(ws, st);
    this.service.onOpen(conn);

    // Sem frame por 15 s → conexão morta (04 §5). O ping de aplicação do cliente mantém viva.
    let lastFrame = now;
    const watchdog = setInterval(() => {
      if (Date.now() - lastFrame > NET.DEAD_CONNECTION_MS) ws.terminate();
    }, 5_000);

    ws.on('message', (data: RawData, isBinary: boolean) => {
      lastFrame = Date.now();
      if (!isBinary) return this.violation(ws, st, 'frame de texto');
      const buf = toUint8(data);
      void this.dispatch(ws, st, buf);
    });
    ws.on('close', () => {
      clearInterval(watchdog);
      this.states.delete(ws);
      this.service.onClose(conn);
    });
    ws.on('error', (e) => this.log.warn('erro de socket', { conn: id, error: String(e) }));
  }

  private async dispatch(ws: WebSocket, st: ConnState, buf: Uint8Array): Promise<void> {
    const now = Date.now();
    const op = peekOp(buf);
    if (op === Op.Input) {
      if (!st.input.take(now)) return this.violation(ws, st, 'input acima da taxa');
      try {
        this.service.onInput(st.conn, decodeInput(buf));
      } catch {
        this.violation(ws, st, 'input malformado');
      }
      return;
    }
    if (op !== Op.Control) return this.violation(ws, st, 'opcode desconhecido');

    const parsed = parseClientControl(buf, NET.MAX_CLIENT_FRAME_BYTES);
    if (!parsed.ok) {
      st.conn.send(encodeError(`frame inválido: ${parsed.error}`));
      return this.violation(ws, st, parsed.error);
    }
    const msg = parsed.value;
    if (msg.t === 'chat_send' && !st.chat.take(now)) return this.rateLimited(ws, st, msg.t);
    if (ACTION_TYPES.has(msg.t) && !st.actions.take(now)) return this.rateLimited(ws, st, msg.t);
    try {
      await this.service.onControl(st.conn, msg);
    } catch (e) {
      this.log.error('falha ao processar mensagem', { t: msg.t, error: String(e) });
    }
  }

  private rateLimited(ws: WebSocket, st: ConnState, t: ClientMsg['t']): void {
    st.conn.send(encodeError('Muitas mensagens; aguarde um instante', 'rate_limited', t));
    this.violation(ws, st, `rate limit ${t}`);
  }

  private violation(ws: WebSocket, st: ConnState, why: string): void {
    const now = Date.now();
    st.violations.push(now);
    while ((st.violations[0] ?? now) < now - 60_000) st.violations.shift();
    if (st.violations.length > MAX_VIOLATIONS_PER_MIN) {
      this.log.warn('conexão encerrada por abuso', { conn: st.conn.id, why });
      ws.close(CloseCode.Abuse, 'abuse');
    }
  }

  // ───────────────────────────── tick ─────────────────────────────

  /** Loop com compensação de drift: agenda para a próxima fronteira, não "+100 ms". */
  private startTicking(): void {
    const tickMs = this.opts.tickMs ?? NET.TICK_MS;
    this.nextTickAt = Date.now() + tickMs;
    const loop = (): void => {
      try {
        this.service.tick();
      } catch (e) {
        this.log.error('falha no tick', { error: String(e) });
      }
      this.nextTickAt += tickMs;
      const delay = this.nextTickAt - Date.now();
      if (delay < -tickMs * 5) this.nextTickAt = Date.now() + tickMs; // atrasou demais: realinha
      this.timer = setTimeout(loop, Math.max(0, delay));
    };
    this.timer = setTimeout(loop, tickMs);
  }
}

function toUint8(data: RawData): Uint8Array {
  if (Array.isArray(data)) return new Uint8Array(Buffer.concat(data));
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
}

import { encodeControl, type ErrorCode } from '@cesar-office/protocol';
function encodeError(message: string, code: ErrorCode = 'bad_request', ref?: ClientMsg['t']): Uint8Array {
  return encodeControl({ t: 'error', code, message, ...(ref ? { ref } : {}) });
}
