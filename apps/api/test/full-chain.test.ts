/**
 * Cadeia completa: login → org → espaço → join (API) → WebSocket no servidor realtime REAL.
 * Prova que o ticket emitido pela API é aceito pelo realtime e coloca o usuário no mapa certo.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL_VERSION } from '@cesar-office/protocol';
import { startServer, TestClient } from '../../realtime/test/harness.ts';
import { call, login, setup } from './helpers.ts';

let rt: Awaited<ReturnType<typeof startServer>>;
let api: Awaited<ReturnType<typeof setup>>;

before(async () => {
  rt = await startServer();
  api = await setup({ wsUrl: rt.url });
});
after(async () => {
  await api.app.close();
  await api.db.close();
  await rt.close();
});

test('ticket da API abre sessão no realtime; colegas do mesmo espaço se veem', async () => {
  const ana = await login(api.app, 'ana@chain.com', 'Ana');
  const org = (await call(api.app, ana, 'POST', '/v1/orgs', { name: 'Chain' })).json<{ id: string }>();
  await call(api.app, ana, 'POST', `/v1/orgs/${org.id}/invites`, { emails: ['bia@chain.com'] });
  const space = (await call(api.app, ana, 'POST', `/v1/orgs/${org.id}/spaces`, { name: 'Sede' })).json<{ id: string }>();
  const bia = await login(api.app, 'bia@chain.com', 'Bia');

  const ja = (await call(api.app, ana, 'POST', `/v1/orgs/${org.id}/spaces/${space.id}/join`)).json<{ wsUrl: string; ticket: string; instanceId: string }>();
  const jb = (await call(api.app, bia, 'POST', `/v1/orgs/${org.id}/spaces/${space.id}/join`)).json<{ wsUrl: string; ticket: string; instanceId: string }>();
  assert.equal(ja.instanceId, jb.instanceId, 'mesmo espaço → mesma instância');
  assert.equal(ja.wsUrl, rt.url);

  const ca = await TestClient.connect(ja.wsUrl);
  const wa = await ca.hello(ja.ticket);
  assert.equal(wa.userId, ana.userId);
  assert.equal(wa.map.mapId, 'sede');

  const cb = await TestClient.connect(jb.wsUrl);
  await cb.hello(jb.ticket);
  const enter = await ca.waitFor('entity_enter');
  assert.equal(enter.entity.displayName, 'Bia');

  // O ticket é de uso único: reaproveitá-lo é recusado pelo realtime.
  const replay = await TestClient.connect(ja.wsUrl);
  replay.send({ t: 'hello', v: PROTOCOL_VERSION, ticket: ja.ticket });
  assert.equal(await replay.closed(), 4001);

  ca.close();
  cb.close();
});

test('ticket de um espaço não dá acesso a org de que a pessoa não é membro', async () => {
  const dono = await login(api.app, 'dono@priv.com');
  const org = (await call(api.app, dono, 'POST', '/v1/orgs', { name: 'Privada' })).json<{ id: string }>();
  const space = (await call(api.app, dono, 'POST', `/v1/orgs/${org.id}/spaces`, { name: 'Sede' })).json<{ id: string }>();
  const intruso = await login(api.app, 'intruso@fora.com');
  const r = await call(api.app, intruso, 'POST', `/v1/orgs/${org.id}/spaces/${space.id}/join`);
  assert.equal(r.statusCode, 404);
});
