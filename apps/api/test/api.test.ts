import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { call, login, refreshCookie, setup } from './helpers.ts';

let ctx: Awaited<ReturnType<typeof setup>>;
before(async () => {
  ctx = await setup();
});
after(async () => {
  await ctx.app.close();
  await ctx.db.close();
});

const createOrg = async (s: Awaited<ReturnType<typeof login>>, name: string, extra: Record<string, unknown> = {}) => {
  const r = await call(ctx.app, s, 'POST', '/v1/orgs', { name, ...extra });
  assert.equal(r.statusCode, 201, r.body);
  return r.json<{ id: string; slug: string }>();
};

test('login de desenvolvimento cria conta, devolve access token e cookie httpOnly de refresh', async () => {
  const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email: 'Ana@Acme.com', displayName: 'Ana' } });
  assert.equal(res.statusCode, 200);
  const c = res.cookies.find((x) => x.name === 'co_rt');
  assert.ok(c);
  assert.equal(c.httpOnly, true);
  assert.equal(c.sameSite, 'Strict');
  assert.equal(c.path, '/v1/auth');
  const me = await call(ctx.app, { userId: '', token: res.json<{ accessToken: string }>().accessToken, refresh: '' }, 'GET', '/v1/me');
  assert.equal(me.json<{ email: string }>().email, 'ana@acme.com', 'e-mail normalizado');
});

test('sem token → 401 em problem+json', async () => {
  const r = await call(ctx.app, null, 'GET', '/v1/me');
  assert.equal(r.statusCode, 401);
  assert.match(r.headers['content-type'] ?? '', /application\/problem\+json/);
  assert.equal(r.json<{ code: string }>().code, 'unauthorized');
});

test('entrada inválida → 400 com campos', async () => {
  const s = await login(ctx.app, 'val@x.com');
  const r = await call(ctx.app, s, 'PATCH', '/v1/me', { displayName: '', hacker: true });
  assert.equal(r.statusCode, 400);
  assert.ok(r.json<{ errors: unknown[] }>().errors.length > 0);
});

test('criar org: criador vira dono; slug único', async () => {
  const s = await login(ctx.app, 'dono@x.com');
  const a = await createOrg(s, 'Escritório Ágil');
  const b = await createOrg(s, 'Escritório Ágil');
  assert.equal(a.slug, 'escritorio-agil');
  assert.notEqual(a.slug, b.slug);
  const me = (await call(ctx.app, s, 'GET', '/v1/me')).json<{ orgs: { id: string; role: string }[] }>();
  assert.equal(me.orgs.find((o) => o.id === a.id)?.role, 'owner');
});

test('convite: quem já tem conta entra na hora; quem não tem entra ao fazer login', async () => {
  const owner = await login(ctx.app, 'chefe@y.com');
  const existing = await login(ctx.app, 'existe@y.com');
  const org = await createOrg(owner, 'Org Y');
  const r = await call(ctx.app, owner, 'POST', `/v1/orgs/${org.id}/invites`, { emails: ['existe@y.com', 'NOVO@y.com'] });
  assert.equal(r.statusCode, 201);
  assert.equal((await call(ctx.app, existing, 'GET', `/v1/orgs/${org.id}`)).statusCode, 200);
  const novo = await login(ctx.app, 'novo@y.com');
  assert.equal((await call(ctx.app, novo, 'GET', `/v1/orgs/${org.id}`)).json<{ role: string }>().role, 'member');
});

test('domínio permitido entra automaticamente como membro', async () => {
  const owner = await login(ctx.app, 'dono@empresa.com.br');
  const org = await createOrg(owner, 'Empresa', { allowedEmailDomain: 'empresa.com.br' });
  const colega = await login(ctx.app, 'colega@empresa.com.br');
  assert.equal((await call(ctx.app, colega, 'GET', `/v1/orgs/${org.id}`)).statusCode, 200);
  const estranho = await login(ctx.app, 'estranho@outra.com');
  assert.equal((await call(ctx.app, estranho, 'GET', `/v1/orgs/${org.id}`)).statusCode, 404, 'não-membro não descobre que a org existe');
});

test('papéis: membro não convida; admin não promove a dono; último dono não sai', async () => {
  const owner = await login(ctx.app, 'o@z.com');
  const admin = await login(ctx.app, 'a@z.com');
  const member = await login(ctx.app, 'm@z.com');
  const org = await createOrg(owner, 'Org Z');
  await call(ctx.app, owner, 'POST', `/v1/orgs/${org.id}/invites`, { emails: ['a@z.com'], role: 'admin' });
  await call(ctx.app, owner, 'POST', `/v1/orgs/${org.id}/invites`, { emails: ['m@z.com'] });

  assert.equal((await call(ctx.app, member, 'POST', `/v1/orgs/${org.id}/invites`, { emails: ['x@z.com'] })).statusCode, 403);
  assert.equal((await call(ctx.app, admin, 'PATCH', `/v1/orgs/${org.id}/members/${member.userId}`, { role: 'owner' })).statusCode, 403);
  assert.equal((await call(ctx.app, admin, 'PATCH', `/v1/orgs/${org.id}/members/${member.userId}`, { role: 'admin' })).statusCode, 204);
  assert.equal((await call(ctx.app, owner, 'PATCH', `/v1/orgs/${org.id}/members/${owner.userId}`, { role: 'admin' })).statusCode, 409);
  assert.equal((await call(ctx.app, owner, 'DELETE', `/v1/orgs/${org.id}/members/${owner.userId}`)).statusCode, 409);
  assert.equal((await call(ctx.app, member, 'DELETE', `/v1/orgs/${org.id}/members/${member.userId}`)).statusCode, 204, 'qualquer um pode sair');
});

test('RLS: espaços de outra org não aparecem nem pelo banco', async () => {
  const a = await login(ctx.app, 'a@rls.com');
  const b = await login(ctx.app, 'b@rls.com');
  const orgA = await createOrg(a, 'RLS A');
  const orgB = await createOrg(b, 'RLS B');
  const sp = await call(ctx.app, a, 'POST', `/v1/orgs/${orgA.id}/spaces`, { name: 'Sede A' });
  assert.equal(sp.statusCode, 201);
  assert.equal((await call(ctx.app, b, 'GET', `/v1/orgs/${orgA.id}/spaces`)).statusCode, 404);

  const seen = await ctx.db.tenant(orgB.id, (sql) => sql.query<{ name: string }>('SELECT name FROM spaces'));
  assert.equal(seen.some((s) => s.name === 'Sede A'), false, 'tenant B não enxerga linhas de A');
  assert.equal((await ctx.db.query('SELECT 1 FROM spaces')).length, 0, 'sem tenant definido: zero linhas');
  await assert.rejects(ctx.db.tenant(orgB.id, (sql) => sql.query('INSERT INTO spaces (org_id, name) VALUES ($1, $2)', [orgA.id, 'invasão'])), /row-level security/);
});

test('join emite ticket que o realtime aceita, com org, espaço e mapa corretos', async () => {
  const s = await login(ctx.app, 'join@j.com', 'Joana');
  const org = await createOrg(s, 'Join Org');
  const space = (await call(ctx.app, s, 'POST', `/v1/orgs/${org.id}/spaces`, { name: 'Sede' })).json<{ id: string }>();
  const r = await call(ctx.app, s, 'POST', `/v1/orgs/${org.id}/spaces/${space.id}/join`);
  assert.equal(r.statusCode, 200, r.body);
  assert.equal(r.headers['cache-control'], 'no-store');
  const j = r.json<{ wsUrl: string; ticket: string; instanceId: string; mapId: string }>();
  assert.equal(j.mapId, 'sede');
  const claims = await ctx.tickets.verify(j.ticket);
  assert.ok(claims);
  assert.deepEqual([claims.userId, claims.orgId, claims.spaceId, claims.instanceId, claims.displayName, claims.role], [s.userId, org.id, space.id, j.instanceId, 'Joana', 'owner']);
});

test('refresh rotaciona; reusar o refresh antigo revoga a família inteira', async () => {
  const s = await login(ctx.app, 'rot@r.com');
  const r1 = await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { co_rt: s.refresh } });
  assert.equal(r1.statusCode, 200);
  const newer = refreshCookie(r1);
  assert.notEqual(newer, s.refresh);

  const replay = await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { co_rt: s.refresh } });
  assert.equal(replay.statusCode, 401, 'token antigo reutilizado');
  const afterTheft = await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { co_rt: newer } });
  assert.equal(afterTheft.statusCode, 401, 'família revogada: o token novo também morre');
});

test('logout revoga a sessão', async () => {
  const s = await login(ctx.app, 'bye@b.com');
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', cookies: { co_rt: s.refresh } })).statusCode, 204);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { co_rt: s.refresh } })).statusCode, 401);
});

test('LGPD: exportar dados e excluir conta (anonimiza, derruba sessões)', async () => {
  const s = await login(ctx.app, 'titular@l.com', 'Titular');
  await call(ctx.app, s, 'POST', '/v1/me/consents', { kind: 'microphone', granted: true, version: '2026-10' });
  const exp = await call(ctx.app, s, 'GET', '/v1/me/export');
  assert.equal(exp.statusCode, 200);
  assert.match(exp.headers['content-disposition'] ?? '', /attachment/);
  const data = exp.json<{ profile: { email: string }; consents: unknown[] }>();
  assert.equal(data.profile.email, 'titular@l.com');
  assert.equal(data.consents.length, 1);

  assert.equal((await call(ctx.app, s, 'DELETE', '/v1/me')).statusCode, 204);
  assert.equal((await call(ctx.app, s, 'GET', '/v1/me')).statusCode, 401);
  assert.equal((await ctx.app.inject({ method: 'POST', url: '/v1/auth/refresh', cookies: { co_rt: s.refresh } })).statusCode, 401);
  const again = await login(ctx.app, 'titular@l.com');
  assert.notEqual(again.userId, s.userId, 'e-mail liberado; conta nova');
});

test('dono único não pode excluir a conta sem transferir a org', async () => {
  const s = await login(ctx.app, 'unico@u.com');
  await createOrg(s, 'Só Minha');
  assert.equal((await call(ctx.app, s, 'DELETE', '/v1/me')).statusCode, 409);
});

test('login de desenvolvimento desligado não existe (404)', async () => {
  const prod = await setup({ devLogin: false });
  assert.equal((await prod.app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email: 'x@x.com' } })).statusCode, 404);
  await prod.app.close();
  await prod.db.close();
});
