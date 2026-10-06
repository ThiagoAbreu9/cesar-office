/**
 * Monta a API real sobre um PostgreSQL real em processo (PGlite), com migrações aplicadas e a
 * sessão rodando como `cesar_app` — o mesmo papel sem privilégios da produção, então o RLS vale.
 */
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { citext } from '@electric-sql/pglite/contrib/citext';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { HmacTicketCodec } from '@cesar-office/ticket';
import { AccountService, AuthService, OrgService, SpaceService } from '../src/application/services.ts';
import { migrate, PgliteDatabase, type PgliteLike } from '../src/infrastructure/database.ts';
import { SqlUnitOfWork } from '../src/infrastructure/sql-repositories.ts';
import { HmacAccessTokens, SingleNodeDirectory, systemClock } from '../src/infrastructure/security.ts';
import { buildApp } from '../src/interface/http.ts';

export const TICKET_SECRET = 's'.repeat(40); // igual ao harness do realtime

export async function setup(opts: { devLogin?: boolean; wsUrl?: string } = {}) {
  const pg = new PGlite({ extensions: { citext, pgcrypto } });
  await migrate((s) => pg.exec(s), async (t, p = []) => (await pg.query(t, [...p])).rows as never[], fileURLToPath(new URL('../migrations', import.meta.url)));
  await pg.exec('SET ROLE cesar_app');
  const db = new PgliteDatabase(pg as unknown as PgliteLike);
  const uow = new SqlUnitOfWork(db);
  const access = new HmacAccessTokens('a'.repeat(40), systemClock);
  const tickets = new HmacTicketCodec({ secret: TICKET_SECRET });
  const app = await buildApp({
    auth: new AuthService(uow, access, systemClock),
    account: new AccountService(uow, systemClock),
    orgs: new OrgService(uow),
    spaces: new SpaceService(uow, tickets, new SingleNodeDirectory(opts.wsUrl ?? 'ws://127.0.0.1:4100/ws'), systemClock),
    access,
    corsOrigins: ['http://localhost:5173'],
    cookieSecure: false,
    devLogin: opts.devLogin ?? true,
    limits: { global: 10_000, auth: 1_000, join: 1_000 },
  });
  return { app, db, pg, tickets };
}

export interface Session {
  readonly userId: string;
  readonly token: string;
  readonly refresh: string;
}

export function refreshCookie(res: LightMyRequestResponse): string {
  const c = res.cookies.find((x) => x.name === 'co_rt');
  if (!c) throw new Error('sem cookie de refresh');
  return c.value;
}

export async function login(app: FastifyInstance, email: string, displayName?: string): Promise<Session> {
  const res = await app.inject({ method: 'POST', url: '/v1/auth/dev-login', payload: { email, ...(displayName ? { displayName } : {}) } });
  if (res.statusCode !== 200) throw new Error(`login ${res.statusCode}: ${res.body}`);
  const body = res.json<{ userId: string; accessToken: string }>();
  return { userId: body.userId, token: body.accessToken, refresh: refreshCookie(res) };
}

export function call(app: FastifyInstance, s: Session | null, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, payload?: unknown) {
  return app.inject({ method, url, ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}), headers: s ? { authorization: `Bearer ${s.token}` } : {} });
}
