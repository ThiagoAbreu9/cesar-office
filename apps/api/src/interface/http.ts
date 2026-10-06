/**
 * Borda HTTP (Fastify). Só traduz HTTP ↔ casos de uso: valida entrada (zod), autentica,
 * aplica limites e converte erros em problem+json (RFC 9457, 09 §1).
 */
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { z, ZodError } from 'zod';
import { AppError, type ErrorCode } from '../domain/model.ts';
import type { AccessTokens } from '../application/ports.ts';
import type { AccountService, AuthService, OrgService, SessionTokens, SpaceService } from '../application/services.ts';

export interface HttpDeps {
  readonly auth: AuthService;
  readonly account: AccountService;
  readonly orgs: OrgService;
  readonly spaces: SpaceService;
  readonly access: AccessTokens;
  readonly corsOrigins: readonly string[];
  readonly cookieSecure: boolean;
  /** Login sem senha por e-mail — SÓ desenvolvimento. Substituído pelo Google depois. */
  readonly devLogin: boolean;
  readonly logger?: boolean;
  /** Limites por minuto (testes podem afrouxar). */
  readonly limits?: { readonly global: number; readonly auth: number; readonly join: number };
}

const REFRESH_COOKIE = 'co_rt';
const REFRESH_PATH = '/v1/auth';
const STATUS: Record<ErrorCode, number> = { bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, conflict: 409, rate_limited: 429 };

declare module 'fastify' {
  interface FastifyRequest {
    userId?: string;
  }
}

// ───────────────────────────── esquemas de entrada ─────────────────────────────

const uuid = z.string().uuid();
const email = z.string().trim().toLowerCase().email().max(254);
const displayName = z.string().trim().min(1).max(40);
const look = z.object({ body: z.number().int().min(0).max(15), hair: z.number().int().min(0).max(15), outfit: z.number().int().min(0).max(15) }).strict();
const domain = z.string().trim().toLowerCase().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/).max(253);

const S = {
  devLogin: z.object({ email, displayName: displayName.optional() }).strict(),
  patchMe: z.object({ displayName: displayName.optional(), avatar: look.optional() }).strict(),
  consent: z.object({ kind: z.enum(['microphone', 'terms', 'privacy']), granted: z.boolean(), version: z.string().min(1).max(20) }).strict(),
  createOrg: z.object({ name: z.string().trim().min(1).max(80), allowedEmailDomain: domain.nullable().optional() }).strict(),
  patchOrg: z
    .object({ name: z.string().trim().min(1).max(80).optional(), allowedEmailDomain: domain.nullable().optional(), chatRetentionDays: z.number().int().min(1).max(3650).optional() })
    .strict(),
  invite: z.object({ emails: z.array(email).min(1).max(100), role: z.enum(['admin', 'member']).default('member') }).strict(),
  setRole: z.object({ role: z.enum(['owner', 'admin', 'member']) }).strict(),
  createSpace: z.object({ name: z.string().trim().min(1).max(60) }).strict(),
  orgParams: z.object({ orgId: uuid }),
  memberParams: z.object({ orgId: uuid, userId: uuid }),
  spaceParams: z.object({ orgId: uuid, spaceId: uuid }),
  page: z.object({ limit: z.coerce.number().int().min(1).max(200).default(50), after: uuid.optional() }),
};

// ───────────────────────────── app ─────────────────────────────

export async function buildApp(d: HttpDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: d.logger ?? false,
    bodyLimit: 16 * 1024,
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });
  const limits = d.limits ?? { global: 300, auth: 10, join: 30 };

  await app.register(helmet);
  await app.register(cors, { origin: [...d.corsOrigins], credentials: true, methods: ['GET', 'POST', 'PATCH', 'DELETE'] });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: limits.global,
    timeWindow: '1 minute',
    errorResponseBuilder: (_req, ctx) => new AppError('rate_limited', `Muitas requisições; tente em ${Math.ceil(ctx.ttl / 1000)} s`),
  });

  app.setErrorHandler((err, req, reply) => problem(err, req, reply));
  app.setNotFoundHandler((req, reply) => problem(new AppError('not_found', 'Rota não encontrada'), req, reply));

  const authed = async (req: FastifyRequest): Promise<void> => {
    const h = req.headers.authorization;
    const userId = h?.startsWith('Bearer ') ? d.access.verify(h.slice(7)) : null;
    if (!userId) throw new AppError('unauthorized', 'Token ausente ou expirado');
    req.userId = userId;
  };
  const uid = (req: FastifyRequest): string => {
    if (!req.userId) throw new AppError('unauthorized', 'Não autenticado');
    return req.userId;
  };
  const authLimit = { config: { rateLimit: { max: limits.auth, timeWindow: '1 minute' } } };

  app.get('/healthz', async () => ({ ok: true }));

  await app.register(
    async (v1) => {
      // ── auth ──
      if (d.devLogin) {
        v1.post('/auth/dev-login', authLimit, async (req, reply) => {
          const body = S.devLogin.parse(req.body);
          const s = await d.auth.signIn({ email: body.email, displayName: body.displayName ?? body.email.split('@')[0] ?? 'Colega' });
          return session(reply, s, d.cookieSecure);
        });
      }
      v1.post('/auth/refresh', authLimit, async (req, reply) => {
        const raw = req.cookies[REFRESH_COOKIE];
        if (!raw) throw new AppError('unauthorized', 'Sem sessão');
        try {
          return session(reply, await d.auth.refresh(raw), d.cookieSecure);
        } catch (e) {
          reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
          throw e;
        }
      });
      v1.post('/auth/logout', async (req, reply) => {
        const raw = req.cookies[REFRESH_COOKIE];
        if (raw) await d.auth.logout(raw);
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
        return reply.code(204).send();
      });

      // ── conta ──
      v1.get('/me', { preHandler: authed }, async (req) => {
        const { user, orgs } = await d.account.me(uid(req));
        return { id: user.id, email: user.email, displayName: user.displayName, avatar: user.avatar, orgs: orgs.map((o) => ({ ...o.org, role: o.role })) };
      });
      v1.patch('/me', { preHandler: authed }, async (req) => {
        const body = S.patchMe.parse(req.body);
        const u = await d.account.update(uid(req), { ...(body.displayName !== undefined ? { displayName: body.displayName } : {}), ...(body.avatar ? { avatar: body.avatar } : {}) });
        return { id: u.id, email: u.email, displayName: u.displayName, avatar: u.avatar };
      });
      v1.post('/me/consents', { preHandler: authed }, async (req, reply) => {
        const b = S.consent.parse(req.body);
        await d.account.consent(uid(req), b.kind, b.granted, b.version);
        return reply.code(204).send();
      });
      v1.get('/me/export', { preHandler: authed }, async (req, reply) => {
        reply.header('content-disposition', 'attachment; filename="meus-dados.json"');
        return d.account.export(uid(req));
      });
      v1.delete('/me', { preHandler: authed }, async (req, reply) => {
        await d.account.delete(uid(req));
        reply.clearCookie(REFRESH_COOKIE, { path: REFRESH_PATH });
        return reply.code(204).send();
      });

      // ── organizações ──
      v1.post('/orgs', { preHandler: authed }, async (req, reply) => {
        const b = S.createOrg.parse(req.body);
        return reply.code(201).send(await d.orgs.create(uid(req), { name: b.name, allowedEmailDomain: b.allowedEmailDomain ?? null }));
      });
      v1.get('/orgs/:orgId', { preHandler: authed }, async (req) => {
        const { orgId } = S.orgParams.parse(req.params);
        const { org, role } = await d.orgs.get(uid(req), orgId);
        return { ...org, role };
      });
      v1.patch('/orgs/:orgId', { preHandler: authed }, async (req) => {
        const { orgId } = S.orgParams.parse(req.params);
        const b = S.patchOrg.parse(req.body);
        return d.orgs.update(uid(req), orgId, {
          ...(b.name !== undefined ? { name: b.name } : {}),
          ...(b.allowedEmailDomain !== undefined ? { allowedEmailDomain: b.allowedEmailDomain } : {}),
          ...(b.chatRetentionDays !== undefined ? { chatRetentionDays: b.chatRetentionDays } : {}),
        });
      });
      v1.get('/orgs/:orgId/members', { preHandler: authed }, async (req) => {
        const { orgId } = S.orgParams.parse(req.params);
        const q = S.page.parse(req.query);
        const items = await d.orgs.members(uid(req), orgId, q.limit, q.after);
        return { items, next: items.length === q.limit ? items.at(-1)?.userId ?? null : null };
      });
      v1.post('/orgs/:orgId/invites', { preHandler: authed }, async (req, reply) => {
        const { orgId } = S.orgParams.parse(req.params);
        const b = S.invite.parse(req.body);
        return reply.code(201).send({ invited: await d.orgs.invite(uid(req), orgId, b.emails, b.role) });
      });
      v1.patch('/orgs/:orgId/members/:userId', { preHandler: authed }, async (req, reply) => {
        const p = S.memberParams.parse(req.params);
        await d.orgs.setRole(uid(req), p.orgId, p.userId, S.setRole.parse(req.body).role);
        return reply.code(204).send();
      });
      v1.delete('/orgs/:orgId/members/:userId', { preHandler: authed }, async (req, reply) => {
        const p = S.memberParams.parse(req.params);
        await d.orgs.remove(uid(req), p.orgId, p.userId);
        return reply.code(204).send();
      });

      // ── espaços ──
      v1.get('/orgs/:orgId/spaces', { preHandler: authed }, async (req) => {
        const { orgId } = S.orgParams.parse(req.params);
        return { items: await d.spaces.list(uid(req), orgId) };
      });
      v1.post('/orgs/:orgId/spaces', { preHandler: authed }, async (req, reply) => {
        const { orgId } = S.orgParams.parse(req.params);
        return reply.code(201).send(await d.spaces.create(uid(req), orgId, S.createSpace.parse(req.body).name));
      });
      v1.post('/orgs/:orgId/spaces/:spaceId/join', { preHandler: authed, config: { rateLimit: { max: limits.join, timeWindow: '1 minute' } } }, async (req, reply) => {
        const p = S.spaceParams.parse(req.params);
        reply.header('cache-control', 'no-store');
        return d.spaces.join(uid(req), p.orgId, p.spaceId);
      });
    },
    { prefix: '/v1' },
  );

  return app;
}

function session(reply: FastifyReply, s: SessionTokens, secure: boolean): { userId: string; accessToken: string; expiresAt: string } {
  reply.setCookie(REFRESH_COOKIE, s.refreshToken, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: REFRESH_PATH,
    expires: s.refreshExpiresAt,
  });
  reply.header('cache-control', 'no-store');
  return { userId: s.userId, accessToken: s.accessToken, expiresAt: s.accessExpiresAt.toISOString() };
}

function problem(err: unknown, req: FastifyRequest, reply: FastifyReply): FastifyReply {
  let code: ErrorCode | 'internal' = 'internal';
  let status = 500;
  let detail = 'Erro interno';
  let errors: unknown;

  if (err instanceof AppError) {
    code = err.code;
    status = STATUS[err.code];
    detail = err.message;
  } else if (err instanceof ZodError) {
    code = 'bad_request';
    status = 400;
    detail = 'Requisição inválida';
    errors = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (typeof err === 'object' && err !== null && 'statusCode' in err && typeof err.statusCode === 'number' && err.statusCode < 500) {
    status = err.statusCode;
    code = status === 429 ? 'rate_limited' : status === 404 ? 'not_found' : 'bad_request';
    detail = err instanceof Error ? err.message : 'Requisição inválida';
  } else {
    req.log.error({ err }, 'erro não tratado');
  }

  return reply
    .code(status)
    .type('application/problem+json')
    .send({ type: `https://docs.cesar-office.dev/errors/${code}`, title: code, status, code, detail, traceId: req.id, ...(errors ? { errors } : {}) });
}
