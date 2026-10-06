/**
 * Casos de uso da API. Sem HTTP, sem SQL: só portas.
 *
 * Login: `signIn(identity)` recebe uma identidade JÁ VERIFICADA por um provedor
 * (hoje: login de desenvolvimento; depois: Google). Trocar o provedor não muda nada aqui.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AvatarLook } from '@cesar-office/protocol';
import {
  AppError,
  assertCanChangeRole,
  assertCanRemove,
  emailDomain,
  isAtLeast,
  slugify,
  type Member,
  type Organization,
  type Role,
  type Space,
  type User,
} from '../domain/model.ts';
import type { AccessTokens, Clock, InstanceDirectory, Repositories, TicketSigner, UnitOfWork } from './ports.ts';

export interface VerifiedIdentity {
  readonly email: string;
  readonly displayName: string;
}

export interface SessionTokens {
  readonly userId: string;
  readonly accessToken: string;
  readonly accessExpiresAt: Date;
  readonly refreshToken: string;
  readonly refreshExpiresAt: Date;
}

const hash = (raw: string): Buffer => createHash('sha256').update(raw).digest();

// ───────────────────────────── autenticação ─────────────────────────────

export class AuthService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly access: AccessTokens,
    private readonly clock: Clock,
    private readonly refreshTtlMs: number = 30 * 24 * 3_600_000,
  ) {}

  async signIn(id: VerifiedIdentity): Promise<SessionTokens> {
    return this.uow.run(async (r) => {
      const user = (await r.users.findByEmail(id.email)) ?? (await r.users.create({ email: id.email, displayName: id.displayName.slice(0, 40) }));
      // Convites pendentes viram membership; domínio permitido entra como membro (RF-01).
      await r.orgs.acceptInvites(user.email, user.id);
      for (const orgId of await r.orgs.orgsAllowingDomain(emailDomain(user.email))) await r.orgs.addMember(orgId, user.id, 'member');
      return this.issue(r, user.id, randomUUID());
    });
  }

  async refresh(raw: string): Promise<SessionTokens> {
    // A revogação por reuso precisa ser COMMITADA antes de responder 401 — por isso o resultado sai da transação.
    const out = await this.uow.run(async (r): Promise<SessionTokens | { error: string }> => {
      const now = this.clock.now();
      const rec = await r.sessions.findByHash(hash(raw));
      if (!rec) return { error: 'Sessão inválida' };
      if (rec.revokedAt || rec.replacedAt) {
        await r.sessions.revokeFamily(rec.familyId, now); // reuso de token antigo = provável roubo
        return { error: 'Sessão revogada' };
      }
      if (rec.expiresAt <= now) return { error: 'Sessão expirada' };
      if (!(await r.sessions.markReplaced(rec.id, now))) {
        await r.sessions.revokeFamily(rec.familyId, now);
        return { error: 'Sessão revogada' };
      }
      const user = await r.users.findById(rec.userId);
      if (!user || user.deletedAt) return { error: 'Conta inexistente' };
      return this.issue(r, rec.userId, rec.familyId);
    });
    if ('error' in out) throw new AppError('unauthorized', out.error);
    return out;
  }

  async logout(raw: string): Promise<void> {
    await this.uow.run(async (r) => {
      const rec = await r.sessions.findByHash(hash(raw));
      if (rec) await r.sessions.revokeFamily(rec.familyId, this.clock.now());
    });
  }

  private async issue(r: Repositories, userId: string, familyId: string): Promise<SessionTokens> {
    const refreshToken = randomBytes(32).toString('base64url');
    const refreshExpiresAt = new Date(this.clock.now().getTime() + this.refreshTtlMs);
    await r.sessions.create({ userId, familyId, tokenHash: hash(refreshToken), expiresAt: refreshExpiresAt });
    const a = this.access.sign(userId);
    return { userId, accessToken: a.token, accessExpiresAt: a.expiresAt, refreshToken, refreshExpiresAt };
  }
}

// ───────────────────────────── conta (LGPD) ─────────────────────────────

export class AccountService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock,
  ) {}

  me(userId: string): Promise<{ user: User; orgs: { org: Organization; role: Role }[] }> {
    return this.uow.run(async (r) => {
      const user = await r.users.findById(userId);
      if (!user || user.deletedAt) throw new AppError('unauthorized', 'Conta inexistente');
      return { user, orgs: await r.orgs.orgsOf(userId) };
    });
  }

  update(userId: string, patch: { displayName?: string; avatar?: AvatarLook }): Promise<User> {
    return this.uow.run((r) => r.users.updateProfile(userId, patch));
  }

  consent(userId: string, kind: 'microphone' | 'terms' | 'privacy', granted: boolean, version: string): Promise<void> {
    return this.uow.run((r) => r.consents.record(userId, kind, granted, version));
  }

  /** Portabilidade (LGPD art. 18, V): tudo que guardamos sobre o titular. */
  async export(userId: string): Promise<Record<string, unknown>> {
    return this.uow.run(async (r) => {
      const user = await r.users.findById(userId);
      if (!user) throw new AppError('not_found', 'Conta inexistente');
      return {
        exportedAt: this.clock.now().toISOString(),
        profile: { id: user.id, email: user.email, displayName: user.displayName, avatar: user.avatar },
        organizations: (await r.orgs.orgsOf(userId)).map((o) => ({ id: o.org.id, name: o.org.name, role: o.role })),
        consents: await r.consents.list(userId),
      };
    });
  }

  /** Eliminação (LGPD art. 18, VI): anonimiza perfil, sai das orgs, derruba sessões. Consentimentos ficam (prova legal). */
  async delete(userId: string): Promise<void> {
    await this.uow.run(async (r) => {
      for (const { org, role } of await r.orgs.orgsOf(userId)) {
        if (role === 'owner' && (await r.orgs.ownersCount(org.id)) <= 1) {
          throw new AppError('conflict', `Transfira a posse de "${org.name}" antes de excluir a conta`);
        }
      }
      await r.sessions.revokeAllForUser(userId, this.clock.now());
      await r.users.anonymize(userId);
    });
  }
}

// ───────────────────────────── organizações ─────────────────────────────

/** Não-membro recebe 404 (não revela que a org existe); membro sem papel suficiente recebe 403. */
async function requireRole(r: Repositories, orgId: string, userId: string, min: Role): Promise<Role> {
  const role = await r.orgs.roleOf(orgId, userId);
  if (!role) throw new AppError('not_found', 'Organização não encontrada');
  if (!isAtLeast(role, min)) throw new AppError('forbidden', 'Permissão insuficiente');
  return role;
}

export class OrgService {
  constructor(private readonly uow: UnitOfWork) {}

  async create(userId: string, input: { name: string; allowedEmailDomain?: string | null }): Promise<Organization> {
    const org = await this.uow.run(async (r) => {
      let slug = slugify(input.name);
      for (let i = 2; await r.orgs.slugExists(slug); i++) slug = `${slugify(input.name).slice(0, 34)}-${i}`;
      return r.orgs.createWithOwner({ name: input.name, slug, allowedEmailDomain: input.allowedEmailDomain ?? null }, userId);
    });
    await this.uow.tenant(org.id, (r) => r.audit.log(org.id, userId, 'org.create', { name: org.name }));
    return org;
  }

  get(userId: string, orgId: string): Promise<{ org: Organization; role: Role }> {
    return this.uow.run(async (r) => {
      const role = await requireRole(r, orgId, userId, 'member');
      const org = await r.orgs.findById(orgId);
      if (!org) throw new AppError('not_found', 'Organização não encontrada');
      return { org, role };
    });
  }

  update(userId: string, orgId: string, patch: { name?: string; allowedEmailDomain?: string | null; chatRetentionDays?: number }): Promise<Organization> {
    return this.uow.tenant(orgId, async (r) => {
      await requireRole(r, orgId, userId, 'admin');
      const org = await r.orgs.update(orgId, patch);
      await r.audit.log(orgId, userId, 'org.update', patch);
      return org;
    });
  }

  members(userId: string, orgId: string, limit: number, after?: string): Promise<Member[]> {
    return this.uow.run(async (r) => {
      await requireRole(r, orgId, userId, 'member');
      return r.orgs.members(orgId, limit, after);
    });
  }

  invite(userId: string, orgId: string, emails: readonly string[], role: 'admin' | 'member'): Promise<number> {
    return this.uow.tenant(orgId, async (r) => {
      const actor = await requireRole(r, orgId, userId, 'admin');
      if (role === 'admin' && actor !== 'owner' && actor !== 'admin') throw new AppError('forbidden', 'Permissão insuficiente');
      const unique = [...new Set(emails.map((e) => e.trim().toLowerCase()))];
      const n = await r.orgs.invite(orgId, unique, role, userId);
      // Quem já tem conta entra na hora.
      for (const email of unique) {
        const u = await r.users.findByEmail(email);
        if (u) await r.orgs.acceptInvites(email, u.id);
      }
      await r.audit.log(orgId, userId, 'member.invite', { count: unique.length, role });
      return n;
    });
  }

  setRole(userId: string, orgId: string, targetId: string, next: Role): Promise<void> {
    return this.uow.tenant(orgId, async (r) => {
      const actor = await requireRole(r, orgId, userId, 'member');
      const target = await r.orgs.roleOf(orgId, targetId);
      if (!target) throw new AppError('not_found', 'Membro não encontrado');
      assertCanChangeRole(actor, target, next, await r.orgs.ownersCount(orgId));
      await r.orgs.setRole(orgId, targetId, next);
      await r.audit.log(orgId, userId, 'member.role', { targetId, from: target, to: next });
    });
  }

  remove(userId: string, orgId: string, targetId: string): Promise<void> {
    return this.uow.tenant(orgId, async (r) => {
      const actor = await requireRole(r, orgId, userId, 'member');
      const target = await r.orgs.roleOf(orgId, targetId);
      if (!target) throw new AppError('not_found', 'Membro não encontrado');
      assertCanRemove(actor, userId, target, targetId, await r.orgs.ownersCount(orgId));
      await r.orgs.removeMember(orgId, targetId);
      await r.audit.log(orgId, userId, 'member.remove', { targetId });
    });
  }
}

// ───────────────────────────── espaços e entrada ─────────────────────────────

export interface JoinResult {
  readonly wsUrl: string;
  readonly ticket: string;
  readonly ticketExpiresAt: Date;
  readonly instanceId: string;
  readonly mapId: string;
}

export class SpaceService {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly tickets: TicketSigner,
    private readonly directory: InstanceDirectory,
    private readonly clock: Clock,
  ) {}

  create(userId: string, orgId: string, name: string, assetKey = 'sede'): Promise<Space> {
    return this.uow.tenant(orgId, async (r) => {
      await requireRole(r, orgId, userId, 'admin');
      const space = await r.spaces.create(orgId, name, assetKey);
      await r.audit.log(orgId, userId, 'space.create', { spaceId: space.id, name });
      return space;
    });
  }

  list(userId: string, orgId: string): Promise<Space[]> {
    return this.uow.tenant(orgId, async (r) => {
      await requireRole(r, orgId, userId, 'member');
      return r.spaces.list(orgId);
    });
  }

  /** POST /orgs/:orgId/spaces/:spaceId/join — escolhe a instância e emite o ticket de 30 s (02 §4.1). */
  async join(userId: string, orgId: string, spaceId: string): Promise<JoinResult> {
    const ctx = await this.uow.tenant(orgId, async (r) => {
      const role = await requireRole(r, orgId, userId, 'member');
      const found = await r.spaces.findWithDefaultMap(orgId, spaceId);
      if (!found) throw new AppError('not_found', 'Espaço não encontrado');
      const user = await r.users.findById(userId);
      if (!user || user.deletedAt) throw new AppError('unauthorized', 'Conta inexistente');
      return { role, found, user, last: await r.spaces.lastPosition(orgId, userId, spaceId) };
    });
    const { instanceId, wsUrl } = await this.directory.locate(orgId, spaceId, ctx.found.map.assetKey);
    const ticket = this.tickets.sign({
      userId,
      orgId,
      spaceId,
      instanceId,
      mapId: ctx.found.map.assetKey,
      role: ctx.role,
      displayName: ctx.user.displayName,
      look: ctx.user.avatar,
      status: 'available',
      ...(ctx.last ? { lastPosition: ctx.last } : {}),
    });
    return {
      wsUrl,
      ticket,
      ticketExpiresAt: new Date(this.clock.now().getTime() + this.tickets.ttlSeconds * 1000),
      instanceId,
      mapId: ctx.found.map.assetKey,
    };
  }
}
