/**
 * Harness de teste: sobe o gateway real numa porta livre e fornece clientes WebSocket
 * que falam o protocolo binário de verdade.
 */
import { WebSocket } from 'ws';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  decodeSnapshot,
  encodeControl,
  encodeInput,
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
import { RealtimeService } from '../src/application/realtime-service.ts';
import type { MediaGateway } from '../src/application/ports.ts';
import { Gateway } from '../src/interface/ws-gateway.ts';
import { HmacTicketCodec } from '@cesar-office/ticket';
import { InMemoryChatStore, InMemoryDeskRepository, InMemoryOrgBus } from '../src/infrastructure/memory-adapters.ts';
import { cryptoIds, FileMapRepository, silentLogger, systemClock } from '../src/infrastructure/system.ts';

export const SECRET = 's'.repeat(40);
export const ORG = randomUUID();
export const SPACE = randomUUID();
const MAPS = resolve(fileURLToPath(new URL('../../../packages/world/maps', import.meta.url)));

export class FakeMedia implements MediaGateway {
  readonly enabled = true;
  readonly joins: { room: string; userId: string; mode: string }[] = [];
  readonly removes: { room: string; userId: string }[] = [];
  async join(room: string, userId: string, _name: string, mode: 'open' | 'zone'): Promise<ServerMsgOf<'media_join'>> {
    this.joins.push({ room, userId, mode });
    return { t: 'media_join', url: 'wss://lk.test', room, token: `tok-${room}-${userId}`, mode };
  }
  async remove(room: string, userId: string): Promise<void> {
    this.removes.push({ room, userId });
  }
}

export async function startServer(opts: { allowedOrigins?: string[] } = {}) {
  const tickets = new HmacTicketCodec({ secret: SECRET });
  const media = new FakeMedia();
  const chat = new InMemoryChatStore();
  const service = new RealtimeService({
    tickets,
    maps: new FileMapRepository(MAPS, 'http://localhost/maps'),
    media,
    chat,
    bus: new InMemoryOrgBus(),
    desks: new InMemoryDeskRepository(),
    clock: systemClock,
    ids: cryptoIds,
    log: silentLogger,
  });
  const gw = new Gateway(service, { port: 0, host: '127.0.0.1', allowedOrigins: opts.allowedOrigins ?? [] }, silentLogger);
  const { port } = await gw.listen();
  const ticket = (userId: string, name: string, extra: { lastPosition?: { x: number; y: number }; instanceId?: string } = {}): string =>
    tickets.sign({
      userId,
      orgId: ORG,
      spaceId: SPACE,
      instanceId: extra.instanceId ?? 'inst_test',
      mapId: 'sede',
      role: 'member',
      displayName: name,
      look: { body: 0, hair: 0, outfit: 0 },
      status: 'available',
      ...(extra.lastPosition ? { lastPosition: extra.lastPosition } : {}),
    });
  return { url: `ws://127.0.0.1:${port}/ws`, port, media, chat, service, ticket, close: () => gw.close() };
}

/** Cliente de teste com caixa de entrada e espera por mensagem. */
export class TestClient {
  readonly inbox: ServerMsg[] = [];
  readonly snapshots: SnapshotFrame[] = [];
  closeCode: number | null = null;
  bytesIn = 0;
  private readonly waiters: { pred: (m: ServerMsg) => boolean; resolve: (m: ServerMsg) => void }[] = [];
  private seq = 0;

  private constructor(readonly ws: WebSocket) {
    ws.binaryType = 'nodebuffer';
    ws.on('message', (data: Buffer) => {
      this.bytesIn += data.byteLength;
      const buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (peekOp(buf) === Op.Snapshot) {
        this.snapshots.push(decodeSnapshot(buf));
        return;
      }
      const r = parseServerControl(buf);
      if (!r.ok) return;
      this.inbox.push(r.value);
      for (const w of [...this.waiters]) {
        if (w.pred(r.value)) {
          this.waiters.splice(this.waiters.indexOf(w), 1);
          w.resolve(r.value);
        }
      }
    });
    ws.on('close', (code) => {
      this.closeCode = code;
    });
  }

  static connect(url: string, headers: Record<string, string> = {}): Promise<TestClient> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers });
      const c = new TestClient(ws);
      ws.once('open', () => resolve(c));
      ws.once('error', reject);
      ws.once('unexpected-response', (_req, res) => reject(new Error(`HTTP ${res.statusCode}`)));
    });
  }

  send(msg: ClientMsg): void {
    this.ws.send(encodeControl(msg));
  }

  input(x: number, y: number, moving = true): void {
    this.seq = (this.seq + 1) & 0xffff;
    const f: InputFrame = { seq: this.seq, x, y, state: { facing: 2, moving, sitting: false, ghost: false } };
    this.ws.send(encodeInput(f));
  }

  hello(ticket: string): Promise<ServerMsgOf<'welcome'>> {
    this.send({ t: 'hello', v: PROTOCOL_VERSION, ticket });
    return this.waitFor('welcome');
  }

  waitFor<T extends ServerMsg['t']>(t: T, pred: (m: Extract<ServerMsg, { t: T }>) => boolean = () => true, timeoutMs = 3000): Promise<Extract<ServerMsg, { t: T }>> {
    const match = (m: ServerMsg): m is Extract<ServerMsg, { t: T }> => m.t === t && pred(m as Extract<ServerMsg, { t: T }>);
    const already = this.inbox.find(match);
    if (already) return Promise.resolve(already);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`timeout esperando ${t}`)), timeoutMs);
      this.waiters.push({
        pred: match,
        resolve: (m) => {
          clearTimeout(timer);
          resolve(m as Extract<ServerMsg, { t: T }>);
        },
      });
    });
  }

  closed(): Promise<number> {
    if (this.closeCode !== null) return Promise.resolve(this.closeCode);
    return new Promise((r) => this.ws.once('close', (code) => r(code)));
  }

  close(): void {
    this.ws.close();
  }
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
