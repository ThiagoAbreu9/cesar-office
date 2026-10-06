/**
 * Teste de carga (07 §8): N bots numa única instância, andando pelo mapa Sede com física válida.
 * Sobe o servidor real em outro processo e mede tick p50/p99 (via /metrics), banda por bot e correções.
 *
 *   node --experimental-transform-types scripts/load.ts [bots=150] [segundos=30]
 */
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import {
  encodeControl,
  encodeInput,
  Op,
  parseServerControl,
  peekOp,
  PROTOCOL_VERSION,
  WORLD,
} from '@cesar-office/protocol';
import { findPath, loadWorldMap, type TiledMap } from '@cesar-office/world';
import { HmacTicketCodec } from '../src/infrastructure/ticket.ts';

const BOTS = Number(process.argv[2] ?? 150);
const SECONDS = Number(process.argv[3] ?? 30);
const PORT = 4199;
const SECRET = 'load-test-secret-'.padEnd(40, 'x');
const ORG = randomUUID();
const SPACE = randomUUID();
const T = WORLD.TILE_PX;

const mapPath = fileURLToPath(new URL('../../../packages/world/maps/sede.json', import.meta.url));
const world = loadWorldMap(JSON.parse(readFileSync(mapPath, 'utf8')) as TiledMap);
const openTiles: { tx: number; ty: number }[] = [];
for (let ty = 0; ty < world.heightTiles; ty++)
  for (let tx = 0; tx < world.widthTiles; tx++)
    if (!world.grid.isBlockedTile(tx, ty) && !world.zoneAt((tx + 0.5) * T, (ty + 0.5) * T)) openTiles.push({ tx, ty });
const pick = <X>(xs: readonly X[]): X => xs[Math.floor(Math.random() * xs.length)] as X;

const server = spawn(process.execPath, ['--experimental-transform-types', 'src/main.ts'], {
  cwd: fileURLToPath(new URL('..', import.meta.url)),
  env: { ...process.env, PORT: String(PORT), TICKET_SECRET: SECRET, MAX_INSTANCE_CCU: '1000', NODE_ENV: 'test' },
  stdio: ['ignore', 'ignore', 'inherit'],
});
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function waitHealthy(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/healthz`)).ok) return;
    } catch {
      /* subindo */
    }
    await sleep(200);
  }
  throw new Error('servidor não subiu');
}

interface BotStats {
  bytes: number;
  corrections: number;
  welcomed: boolean;
}

function runBot(i: number, codec: HmacTicketCodec, stopAt: number, stats: BotStats): Promise<void> {
  return new Promise((resolve) => {
    const start = pick(openTiles);
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
    ws.binaryType = 'nodebuffer';
    let x = (start.tx + 0.5) * T;
    let y = (start.ty + 0.5) * T;
    let path: { x: number; y: number }[] = [];
    let seq = 0;
    let idleUntil = 0;
    let timer: NodeJS.Timeout | null = null;
    let pinger: NodeJS.Timeout | null = null;

    ws.on('open', () => {
      const ticket = codec.sign({
        userId: randomUUID(), orgId: ORG, spaceId: SPACE, instanceId: 'inst_load', mapId: 'sede', role: 'member',
        displayName: `bot${i}`, look: { body: i % 3, hair: 0, outfit: 0 }, status: 'available', lastPosition: { x: Math.round(x), y: Math.round(y) },
      });
      ws.send(encodeControl({ t: 'hello', v: PROTOCOL_VERSION, ticket }));
    });

    ws.on('message', (data: Buffer) => {
      stats.bytes += data.byteLength;
      const buf = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      if (peekOp(buf) !== Op.Control) return;
      const r = parseServerControl(buf);
      if (!r.ok) return;
      const m = r.value;
      if (m.t === 'welcome') {
        stats.welcomed = true;
        x = m.self.x;
        y = m.self.y;
        timer = setInterval(step, 100);
        pinger = setInterval(() => ws.send(encodeControl({ t: 'ping', c: Date.now() })), 5000);
      } else if (m.t === 'correction') {
        stats.corrections++;
        x = m.x;
        y = m.y;
        path = [];
      }
    });

    const finish = (): void => {
      if (timer) clearInterval(timer);
      if (pinger) clearInterval(pinger);
      ws.close();
      resolve();
    };
    ws.on('close', finish);
    ws.on('error', finish);

    function step(): void {
      const now = Date.now();
      if (now > stopAt) return finish();
      if (now < idleUntil) return;
      if (path.length === 0) {
        // Escritório: metade do tempo parado (sentado/conversando), metade andando.
        if (Math.random() < 0.5) {
          idleUntil = now + 2000 + Math.random() * 6000;
          return;
        }
        const goal = pick(openTiles);
        const p = findPath(world.grid, { tx: Math.floor(x / T), ty: Math.floor(y / T) }, goal, 60);
        if (!p) return;
        path = p.slice(1).map((t) => ({ x: (t.tx + 0.5) * T, y: (t.ty + 0.5) * T }));
      }
      // 100 ms a 4 tiles/s = 12,8 px; um pouco menos para não esbarrar na tolerância.
      let budget = (WORLD.WALK_SPEED_PX_S * 100) / 1000 - 0.5;
      while (budget > 0 && path.length > 0) {
        const n = path[0] as { x: number; y: number };
        const d = Math.hypot(n.x - x, n.y - y);
        if (d <= budget) {
          x = n.x;
          y = n.y;
          budget -= d;
          path.shift();
        } else {
          x += ((n.x - x) / d) * budget;
          y += ((n.y - y) / d) * budget;
          budget = 0;
        }
      }
      seq = (seq + 1) & 0xffff;
      ws.send(encodeInput({ seq, x: Math.round(x), y: Math.round(y), state: { facing: 0, moving: path.length > 0, sitting: false, ghost: false } }));
    }
  });
}

try {
  await waitHealthy();
  const codec = new HmacTicketCodec({ secret: SECRET });
  const stopAt = Date.now() + SECONDS * 1000;
  const stats: BotStats[] = Array.from({ length: BOTS }, () => ({ bytes: 0, corrections: 0, welcomed: false }));
  const runs: Promise<void>[] = [];
  for (let i = 0; i < BOTS; i++) {
    runs.push(runBot(i, codec, stopAt, stats[i] as BotStats));
    if (i % 25 === 24) await sleep(100); // rampa
  }
  await sleep(Math.max(0, stopAt - Date.now() - 1500));
  const metrics = (await (await fetch(`http://127.0.0.1:${PORT}/metrics`)).json()) as { tickP50: number; tickP99: number; instances: { ccu: number }[] };
  await Promise.all(runs);

  const welcomed = stats.filter((s) => s.welcomed).length;
  const kbps = stats.map((s) => s.bytes / 1024 / SECONDS).sort((a, b) => a - b);
  const corrections = stats.reduce((n, s) => n + s.corrections, 0);
  console.log(
    JSON.stringify(
      {
        bots: BOTS,
        segundos: SECONDS,
        conectados: welcomed,
        ccuNoServidor: metrics.instances[0]?.ccu ?? 0,
        tickP50ms: Number(metrics.tickP50.toFixed(3)),
        tickP99ms: Number(metrics.tickP99.toFixed(3)),
        kbPorSegPorBot: { mediana: Number((kbps[Math.floor(kbps.length / 2)] ?? 0).toFixed(2)), p95: Number((kbps[Math.floor(kbps.length * 0.95)] ?? 0).toFixed(2)) },
        correcoesTotais: corrections,
      },
      null,
      2,
    ),
  );
} finally {
  server.kill('SIGTERM');
}
