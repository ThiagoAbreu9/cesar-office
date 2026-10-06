/**
 * Modo demo: rota de entrada sem conta e rota de mapas. Sobe um http.Server real numa porta efêmera.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { HmacTicketCodec } from '@cesar-office/ticket';
import { DEMO, DemoHttp } from '../src/interface/demo-http.ts';

const tickets = new HmacTicketCodec({ secret: 'demo-test-secret-with-at-least-32-chars!!' });
const mapsDir = fileURLToPath(new URL('../../../packages/world/maps', import.meta.url));
let server: Server;
let base = '';

function serve(demo: DemoHttp): Promise<Server> {
  const s = createServer((req, res) => {
    if (!demo.handle(req, res)) res.writeHead(404).end();
  });
  return new Promise((r) => s.listen(0, '127.0.0.1', () => r(s)));
}

before(async () => {
  server = await serve(new DemoHttp({ mapsDir, allowedOrigins: ['http://ok.test'], tickets, publicWsUrl: 'ws://x/ws' }));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => server.close());

const join = (body: unknown): Promise<Response> =>
  fetch(`${base}/demo/join`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'http://ok.test' }, body: JSON.stringify(body) });

test('entra só com o nome e recebe um ticket válido para o espaço demo', async () => {
  const res = await join({ name: '  Thiago ', body: 1, hair: 7, outfit: 4 });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), 'http://ok.test');
  const { wsUrl, ticket } = (await res.json()) as { wsUrl: string; ticket: string };
  assert.equal(wsUrl, 'ws://x/ws');
  const claims = await tickets.verify(ticket);
  assert.ok(claims);
  assert.equal(claims.displayName, 'Thiago');
  assert.equal(claims.orgId, DEMO.ORG_ID);
  assert.equal(claims.instanceId, DEMO.INSTANCE_ID);
  assert.deepEqual(claims.look, { body: 1, hair: 7, outfit: 4 });
});

test('rejeita nome vazio ou longo demais', async () => {
  assert.equal((await join({ name: '   ' })).status, 400);
  assert.equal((await join({ name: 'x'.repeat(41) })).status, 400);
  assert.equal((await join({ name: 'ok', hair: 99 })).status, 400);
});

test('origem fora da lista não recebe cabeçalho CORS', async () => {
  const res = await fetch(`${base}/maps/sede.json`, { headers: { origin: 'http://evil.test' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('access-control-allow-origin'), null);
  assert.equal(((await res.json()) as { type: string }).type, 'map');
});

test('mapa inexistente e caminho com travessia dão 404', async () => {
  assert.equal((await fetch(`${base}/maps/nao-existe.json`)).status, 404);
  assert.equal((await fetch(`${base}/maps/..%2Fsecret.json`)).status, 404);
});

test('limita entradas por IP (10 por minuto)', async () => {
  const s = await serve(new DemoHttp({ mapsDir, allowedOrigins: [], tickets, publicWsUrl: 'ws://x/ws' }));
  const url = `http://127.0.0.1:${(s.address() as AddressInfo).port}/demo/join`;
  const codes: number[] = [];
  for (let i = 0; i < 12; i++) {
    codes.push((await fetch(url, { method: 'POST', body: JSON.stringify({ name: 'a' }) })).status);
  }
  s.close();
  assert.deepEqual(codes.slice(0, 10), Array(10).fill(200));
  assert.equal(codes[11], 429);
});

test('com o modo demo desligado, a entrada sem conta não existe', async () => {
  const s = await serve(new DemoHttp({ mapsDir, allowedOrigins: [], tickets: null, publicWsUrl: 'ws://x/ws' }));
  const res = await fetch(`http://127.0.0.1:${(s.address() as AddressInfo).port}/demo/join`, { method: 'POST', body: '{"name":"a"}' });
  s.close();
  assert.equal(res.status, 404);
});
