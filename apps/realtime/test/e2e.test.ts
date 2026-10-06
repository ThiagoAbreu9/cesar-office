/**
 * Ponta a ponta: gateway real + clientes WebSocket reais + protocolo binário real.
 * Só a mídia é falsa (registra joins/removes que iriam ao LiveKit).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { loadWorldMap, type TiledMap } from '@cesar-office/world';
import { PROTOCOL_VERSION } from '@cesar-office/protocol';
import { sleep, startServer, TestClient } from './harness.ts';

const map = loadWorldMap(JSON.parse(readFileSync(new URL('../../../packages/world/maps/sede.json', import.meta.url), 'utf8')) as TiledMap);
let srv: Awaited<ReturnType<typeof startServer>>;
before(async () => {
  srv = await startServer();
});
after(async () => {
  await srv.close();
});

let instSeq = 0;
const freshInstance = (): string => `inst_${++instSeq}`;

async function pair(instanceId = freshInstance()) {
  const ua = randomUUID();
  const ub = randomUUID();
  const a = await TestClient.connect(srv.url);
  const wa = await a.hello(srv.ticket(ua, 'Ana', { instanceId }));
  const b = await TestClient.connect(srv.url);
  const wb = await b.hello(srv.ticket(ub, 'Bia', { instanceId, lastPosition: { x: wa.self.x + 64, y: wa.self.y } }));
  return { a, b, ua, ub, wa, wb, instanceId };
}

test('hello → welcome com mapa, zona e sala de áudio aberta', async () => {
  const c = await TestClient.connect(srv.url);
  const instanceId = freshInstance();
  const w = await c.hello(srv.ticket(randomUUID(), 'Ana', { instanceId }));
  assert.equal(w.map.mapId, 'sede');
  assert.match(w.map.url, /sede\.json\?v=/);
  assert.equal(w.entities.length, 1);
  assert.equal((await c.waitFor('zone')).zoneKey, null);
  const mj = await c.waitFor('media_join');
  assert.equal(mj.room, `${instanceId}.open`);
  assert.equal(mj.mode, 'open');
  c.close();
});

test('ticket inválido e ticket reutilizado são recusados (4001)', async () => {
  const bad = await TestClient.connect(srv.url);
  bad.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: 'x'.repeat(40) });
  assert.equal((await bad.waitFor('error')).code, 'unauthorized');
  assert.equal(await bad.closed(), 4001);

  const t = srv.ticket(randomUUID(), 'Rui', { instanceId: freshInstance() });
  const c1 = await TestClient.connect(srv.url);
  await c1.hello(t);
  const c2 = await TestClient.connect(srv.url);
  c2.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: t });
  assert.equal(await c2.closed(), 4001, 'replay de ticket');
  c1.close();
});

test('entrada de vizinho e movimento chegam por entity_enter e snapshot binário', async () => {
  const { a, b, wa } = await pair();
  const enter = await a.waitFor('entity_enter');
  assert.equal(enter.entity.displayName, 'Bia');
  b.input(enter.entity.x + 12, enter.entity.y);
  await sleep(250);
  const seen = a.snapshots.flatMap((s) => s.entities).find((e) => e.netId === enter.entity.netId);
  assert.ok(seen, 'snapshot com a Bia');
  assert.equal(seen.x, enter.entity.x + 12);
  assert.ok(wa.netId !== enter.entity.netId);
  a.close();
  b.close();
});

test('speed hack recebe correction e o vizinho não vê o teleporte', async () => {
  const { a, b, wb } = await pair();
  const enter = await a.waitFor('entity_enter');
  b.input(wb.self.x + 400, wb.self.y);
  const c = await b.waitFor('correction');
  assert.equal(c.reason, 'speed');
  await sleep(250);
  assert.equal(a.snapshots.flatMap((s) => s.entities).some((e) => e.netId === enter.entity.netId && e.x > wb.self.x + 100), false);
  a.close();
  b.close();
});

test('áudio: vizinhos próximos recebem audible; chat "aqui" vai à bolha; duplicata é ack uma vez', async () => {
  const { a, b, ua, ub } = await pair();
  const audA = await a.waitFor('audible', (m) => m.peers.length > 0, 2000);
  assert.deepEqual(audA.peers.map((p) => p.userId), [ub]);
  await b.waitFor('audible', (m) => m.peers.some((p) => p.userId === ua));

  const clientMsgId = randomUUID();
  a.send({ t: 'chat_send', channel: 'here', clientMsgId, body: 'café?' });
  a.send({ t: 'chat_send', channel: 'here', clientMsgId, body: 'café?' });
  const got = await b.waitFor('chat');
  assert.equal(got.body, 'café?');
  assert.equal(got.channel, 'here');
  await sleep(150);
  assert.equal(b.inbox.filter((m) => m.t === 'chat').length, 1, 'sem duplicata');
  assert.equal(a.inbox.filter((m) => m.t === 'chat_ack').length, 2, 'dois acks, mesmo id');
  const acks = a.inbox.filter((m) => m.t === 'chat_ack');
  assert.equal(acks[0]?.t === 'chat_ack' && acks[1]?.t === 'chat_ack' && acks[0].id === acks[1].id, true);
  assert.equal(srv.chat.persisted.some((r) => r.clientMsgId === clientMsgId), false, 'bolha aberta não persiste (ADR-0007)');
  a.close();
  b.close();
});

test('chat global chega a toda a org e é persistido', async () => {
  const { a, b } = await pair();
  const far = await TestClient.connect(srv.url);
  await far.hello(srv.ticket(randomUUID(), 'Zeca', { instanceId: freshInstance() })); // outra instância, mesma org
  const id = randomUUID();
  a.send({ t: 'chat_send', channel: 'global', clientMsgId: id, body: 'almoço!' });
  assert.equal((await far.waitFor('chat')).body, 'almoço!');
  assert.equal((await b.waitFor('chat')).channel, 'global');
  assert.ok(srv.chat.persisted.some((r) => r.clientMsgId === id && r.channel === 'global'));
  for (const c of [a, b, far]) c.close();
});

test('entrar na sala: troca de sala de áudio; sair: remoção ativa no SFU', async () => {
  const instanceId = freshInstance();
  const door = map.doorOf('ipe')!;
  const u = randomUUID();
  const c = await TestClient.connect(srv.url);
  const w = await c.hello(srv.ticket(u, 'Eva', { instanceId, lastPosition: { x: door.x, y: door.y } }));
  await c.waitFor('media_join', (m) => m.mode === 'open');
  await sleep(300);
  c.input(w.self.x, w.self.y + 32);
  const z = await c.waitFor('zone', (m) => m.zoneKey === 'ipe');
  assert.equal(z.capacity, 4);
  assert.equal((await c.waitFor('media_leave', (m) => m.room.endsWith('.open'))).room, `${instanceId}.open`);
  assert.equal((await c.waitFor('media_join', (m) => m.mode === 'zone')).room, `${instanceId}.zone.ipe`);
  await sleep(300);
  c.input(w.self.x, w.self.y);
  await c.waitFor('media_leave', (m) => m.room.endsWith('.zone.ipe'));
  await sleep(50);
  assert.ok(srv.media.removes.some((r) => r.room === `${instanceId}.zone.ipe` && r.userId === u), 'RemoveParticipant chamado');
  c.close();
});

test('queda + resume: mesma entidade, token rotacionado, vizinho viu ghost', async () => {
  const { a, b, wb } = await pair();
  const enterB = await a.waitFor('entity_enter');
  b.ws.terminate();
  await sleep(300);
  assert.ok(a.snapshots.flatMap((s) => s.entities).some((e) => e.netId === enterB.entity.netId && e.state.ghost), 'ghost visível');
  const b2 = await TestClient.connect(srv.url);
  b2.send({ t: 'resume', v: PROTOCOL_VERSION, resumeToken: wb.resumeToken, lastTick: 0 });
  const r = await b2.waitFor('resumed');
  assert.notEqual(r.resumeToken, wb.resumeToken);
  assert.ok(r.entities.some((e) => e.netId === wb.netId));
  const b3 = await TestClient.connect(srv.url);
  b3.send({ t: 'resume', v: PROTOCOL_VERSION, resumeToken: wb.resumeToken, lastTick: 0 });
  assert.equal((await b3.waitFor('resume_rejected')).reason, 'expired', 'token antigo não serve');
  a.close();
  b2.close();
});

test('nova aba assume o avatar; a antiga recebe kicked e 4004', async () => {
  const u = randomUUID();
  const instanceId = freshInstance();
  const t1 = await TestClient.connect(srv.url);
  const w1 = await t1.hello(srv.ticket(u, 'Ana', { instanceId }));
  const t2 = await TestClient.connect(srv.url);
  const w2 = await t2.hello(srv.ticket(u, 'Ana', { instanceId }));
  assert.equal((await t1.waitFor('kicked')).reason, 'replaced_by_new_tab');
  assert.equal(await t1.closed(), 4004);
  assert.equal(w2.netId, w1.netId);
  t2.close();
});

test('rate limit de chat responde rate_limited', async () => {
  const c = await TestClient.connect(srv.url);
  await c.hello(srv.ticket(randomUUID(), 'Spam', { instanceId: freshInstance() }));
  for (let i = 0; i < 25; i++) c.send({ t: 'chat_send', channel: 'here', clientMsgId: randomUUID(), body: `m${i}` });
  assert.equal((await c.waitFor('error', (m) => m.code === 'rate_limited')).ref, 'chat_send');
  c.close();
});

test('origem não permitida é recusada no upgrade', async () => {
  const strict = await startServer({ allowedOrigins: ['https://office.exemplo.com'] });
  await assert.rejects(TestClient.connect(strict.url, { origin: 'https://evil.example' }), /HTTP 401/);
  const ok = await TestClient.connect(strict.url, { origin: 'https://office.exemplo.com' });
  ok.close();
  await strict.close();
});
