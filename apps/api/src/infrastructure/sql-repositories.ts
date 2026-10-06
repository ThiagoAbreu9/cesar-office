/**
 * Repositórios em SQL puro (parametrizado — nunca concatenação de entrada do usuário).
 * Tabelas com RLS (spaces, maps, user_space_state, audit_log) só funcionam dentro de `tenant()`.
 */
import type { AvatarLook } from '@cesar-office/protocol';
import type { Member, MapRef, Organization, Role, Space, User } from '../domain/model.ts';
import { AppError } from '../domain/model.ts';
import type {
  AuditRepository,
  ConsentRepository,
  OrgRepository,
  Repositories,
  SessionRecord,
  SessionRepository,
  SpaceRepository,
  UnitOfWork,
  UserRepository,
} from '../application/ports.ts';
import type { Database, Sql } from './database.ts';

interface UserRow { id: string; email: string; display_name: string; avatar: AvatarLook; deleted_at: Date | null }
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, displayName: r.display_name, avatar: r.avatar, deletedAt: r.deleted_at });

interface OrgRow { id: string; name: string; slug: string; allowed_email_domain: string | null; chat_retention_days: number }
const toOrg = (r: OrgRow): Organization => ({
  id: r.id,
  name: r.name,
  slug: r.slug,
  allowedEmailDomain: r.allowed_email_domain,
  chatRetentionDays: r.chat_retention_days,
});

const USER_COLS = 'id, email, display_name, avatar, deleted_at';
const ORG_COLS = 'id, name, slug, allowed_email_domain, chat_retention_days';

function one<T>(rows: T[], what: string): T {
  const r = rows[0];
  if (!r) throw new AppError('not_found', `${what} não encontrado`);
  return r;
}

class SqlUsers implements UserRepository {
  constructor(private readonly sql: Sql) {}

  async findById(id: string): Promise<User | null> {
    const [r] = await this.sql.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE id = $1`, [id]);
    return r ? toUser(r) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const [r] = await this.sql.query<UserRow>(`SELECT ${USER_COLS} FROM users WHERE email = $1 AND deleted_at IS NULL`, [email]);
    return r ? toUser(r) : null;
  }

  async create(input: { email: string; displayName: string }): Promise<User> {
    const rows = await this.sql.query<UserRow>(`INSERT INTO users (email, display_name) VALUES ($1, $2) RETURNING ${USER_COLS}`, [input.email, input.displayName]);
    return toUser(one(rows, 'usuário'));
  }

  async updateProfile(id: string, patch: { displayName?: string; avatar?: AvatarLook }): Promise<User> {
    const rows = await this.sql.query<UserRow>(
      `UPDATE users SET display_name = COALESCE($2, display_name), avatar = COALESCE($3::jsonb, avatar)
       WHERE id = $1 AND deleted_at IS NULL RETURNING ${USER_COLS}`,
      [id, patch.displayName ?? null, patch.avatar ? JSON.stringify(patch.avatar) : null],
    );
    return toUser(one(rows, 'usuário'));
  }

  async anonymize(id: string): Promise<void> {
    await this.sql.query(
      `UPDATE users SET email = 'removido+' || id || '@invalid', google_sub = NULL, display_name = 'Usuário removido',
         avatar = '{"body":0,"hair":0,"outfit":0}', deleted_at = now() WHERE id = $1`,
      [id],
    );
    await this.sql.query('DELETE FROM memberships WHERE user_id = $1', [id]);
  }
}

interface SessionRow { id: string; user_id: string; family_id: string; expires_at: Date; replaced_at: Date | null; revoked_at: Date | null }

class SqlSessions implements SessionRepository {
  constructor(private readonly sql: Sql) {}

  async create(i: { userId: string; familyId: string; tokenHash: Buffer; expiresAt: Date }): Promise<void> {
    await this.sql.query('INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at) VALUES ($1, $2, $3, $4)', [i.userId, i.familyId, i.tokenHash, i.expiresAt]);
  }

  async findByHash(h: Buffer): Promise<SessionRecord | null> {
    const [r] = await this.sql.query<SessionRow>('SELECT id, user_id, family_id, expires_at, replaced_at, revoked_at FROM refresh_tokens WHERE token_hash = $1', [h]);
    return r ? { id: r.id, userId: r.user_id, familyId: r.family_id, expiresAt: r.expires_at, replacedAt: r.replaced_at, revokedAt: r.revoked_at } : null;
  }

  async markReplaced(id: string, at: Date): Promise<boolean> {
    const rows = await this.sql.query('UPDATE refresh_tokens SET replaced_at = $2 WHERE id = $1 AND replaced_at IS NULL AND revoked_at IS NULL RETURNING id', [id, at]);
    return rows.length === 1;
  }

  async revokeFamily(familyId: string, at: Date): Promise<void> {
    await this.sql.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE family_id = $1 AND revoked_at IS NULL', [familyId, at]);
  }

  async revokeAllForUser(userId: string, at: Date): Promise<void> {
    await this.sql.query('UPDATE refresh_tokens SET revoked_at = $2 WHERE user_id = $1 AND revoked_at IS NULL', [userId, at]);
  }
}

class SqlOrgs implements OrgRepository {
  constructor(private readonly sql: Sql) {}

  async createWithOwner(i: { name: string; slug: string; allowedEmailDomain: string | null }, ownerId: string): Promise<Organization> {
    const rows = await this.sql.query<OrgRow>(`INSERT INTO organizations (name, slug, allowed_email_domain) VALUES ($1, $2, $3) RETURNING ${ORG_COLS}`, [i.name, i.slug, i.allowedEmailDomain]);
    const org = toOrg(one(rows, 'organização'));
    await this.sql.query(`INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, 'owner')`, [org.id, ownerId]);
    return org;
  }

  async findById(id: string): Promise<Organization | null> {
    const [r] = await this.sql.query<OrgRow>(`SELECT ${ORG_COLS} FROM organizations WHERE id = $1`, [id]);
    return r ? toOrg(r) : null;
  }

  async slugExists(slug: string): Promise<boolean> {
    return (await this.sql.query('SELECT 1 FROM organizations WHERE slug = $1', [slug])).length > 0;
  }

  async update(id: string, p: { name?: string; allowedEmailDomain?: string | null; chatRetentionDays?: number }): Promise<Organization> {
    const rows = await this.sql.query<OrgRow>(
      `UPDATE organizations SET
         name = COALESCE($2, name),
         allowed_email_domain = CASE WHEN $3::boolean THEN $4 ELSE allowed_email_domain END,
         chat_retention_days = COALESCE($5, chat_retention_days)
       WHERE id = $1 RETURNING ${ORG_COLS}`,
      [id, p.name ?? null, p.allowedEmailDomain !== undefined, p.allowedEmailDomain ?? null, p.chatRetentionDays ?? null],
    );
    return toOrg(one(rows, 'organização'));
  }

  async orgsOf(userId: string): Promise<{ org: Organization; role: Role }[]> {
    const rows = await this.sql.query<OrgRow & { role: Role }>(
      `SELECT o.id, o.name, o.slug, o.allowed_email_domain, o.chat_retention_days, m.role
       FROM memberships m JOIN organizations o ON o.id = m.org_id WHERE m.user_id = $1 ORDER BY o.name`,
      [userId],
    );
    return rows.map((r) => ({ org: toOrg(r), role: r.role }));
  }

  async roleOf(orgId: string, userId: string): Promise<Role | null> {
    const [r] = await this.sql.query<{ role: Role }>('SELECT role FROM memberships WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
    return r?.role ?? null;
  }

  async members(orgId: string, limit: number, after?: string): Promise<Member[]> {
    const rows = await this.sql.query<{ user_id: string; email: string; display_name: string; role: Role; joined_at: Date }>(
      `SELECT m.user_id, u.email, u.display_name, m.role, m.joined_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.org_id = $1 AND ($2::uuid IS NULL OR m.user_id > $2::uuid)
       ORDER BY m.user_id LIMIT $3`,
      [orgId, after ?? null, limit],
    );
    return rows.map((r) => ({ userId: r.user_id, email: r.email, displayName: r.display_name, role: r.role, joinedAt: r.joined_at }));
  }

  async ownersCount(orgId: string): Promise<number> {
    const [r] = await this.sql.query<{ n: number }>(`SELECT count(*)::int AS n FROM memberships WHERE org_id = $1 AND role = 'owner'`, [orgId]);
    return r?.n ?? 0;
  }

  async addMember(orgId: string, userId: string, role: Role): Promise<void> {
    await this.sql.query('INSERT INTO memberships (org_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [orgId, userId, role]);
  }

  async setRole(orgId: string, userId: string, role: Role): Promise<void> {
    await this.sql.query('UPDATE memberships SET role = $3 WHERE org_id = $1 AND user_id = $2', [orgId, userId, role]);
  }

  async removeMember(orgId: string, userId: string): Promise<void> {
    await this.sql.query('DELETE FROM memberships WHERE org_id = $1 AND user_id = $2', [orgId, userId]);
  }

  async orgsAllowingDomain(domain: string): Promise<string[]> {
    return (await this.sql.query<{ id: string }>('SELECT id FROM organizations WHERE allowed_email_domain = $1', [domain])).map((r) => r.id);
  }

  async invite(orgId: string, emails: readonly string[], role: Exclude<Role, 'owner'>, invitedBy: string): Promise<number> {
    const rows = await this.sql.query(
      `INSERT INTO invites (org_id, email, role, invited_by)
       SELECT $1, e, $3, $4 FROM jsonb_array_elements_text($2::jsonb) AS e
       ON CONFLICT (org_id, email) DO UPDATE SET role = EXCLUDED.role, invited_by = EXCLUDED.invited_by, created_at = now()
         WHERE invites.accepted_at IS NULL
       RETURNING email`,
      [orgId, JSON.stringify(emails), role, invitedBy], // JSON: mesmo comportamento em pg e PGlite
    );
    return rows.length;
  }

  async acceptInvites(email: string, userId: string): Promise<string[]> {
    const rows = await this.sql.query<{ org_id: string; role: Role }>(
      'UPDATE invites SET accepted_at = now() WHERE email = $1 AND accepted_at IS NULL RETURNING org_id, role',
      [email],
    );
    for (const r of rows) await this.addMember(r.org_id, userId, r.role);
    return rows.map((r) => r.org_id);
  }
}

class SqlSpaces implements SpaceRepository {
  constructor(private readonly sql: Sql) {}

  async create(orgId: string, name: string, assetKey: string): Promise<Space> {
    const [s] = await this.sql.query<{ id: string; org_id: string; name: string }>('INSERT INTO spaces (org_id, name) VALUES ($1, $2) RETURNING id, org_id, name', [orgId, name]);
    const space = one(s ? [s] : [], 'espaço');
    await this.sql.query('INSERT INTO maps (org_id, space_id, name, asset_key, is_default) VALUES ($1, $2, $3, $4, true)', [orgId, space.id, 'Térreo', assetKey]);
    return { id: space.id, orgId: space.org_id, name: space.name };
  }

  async list(orgId: string): Promise<Space[]> {
    const rows = await this.sql.query<{ id: string; org_id: string; name: string }>('SELECT id, org_id, name FROM spaces WHERE org_id = $1 ORDER BY created_at', [orgId]);
    return rows.map((r) => ({ id: r.id, orgId: r.org_id, name: r.name }));
  }

  async findWithDefaultMap(orgId: string, spaceId: string): Promise<{ space: Space; map: MapRef } | null> {
    const [r] = await this.sql.query<{ id: string; name: string; map_id: string; asset_key: string; version: number }>(
      `SELECT s.id, s.name, m.id AS map_id, m.asset_key, m.version
       FROM spaces s JOIN maps m ON m.space_id = s.id AND m.is_default
       WHERE s.org_id = $1 AND s.id = $2`,
      [orgId, spaceId],
    );
    return r ? { space: { id: r.id, orgId, name: r.name }, map: { id: r.map_id, assetKey: r.asset_key, version: r.version } } : null;
  }

  async lastPosition(orgId: string, userId: string, spaceId: string): Promise<{ x: number; y: number } | null> {
    const [r] = await this.sql.query<{ x: number; y: number }>(
      `SELECT x, y FROM user_space_state WHERE org_id = $1 AND user_id = $2 AND space_id = $3 AND updated_at > now() - interval '12 hours'`,
      [orgId, userId, spaceId],
    );
    return r ?? null;
  }
}

class SqlConsents implements ConsentRepository {
  constructor(private readonly sql: Sql) {}
  async record(userId: string, kind: 'microphone' | 'terms' | 'privacy', granted: boolean, version: string): Promise<void> {
    await this.sql.query('INSERT INTO consents (user_id, kind, granted, version) VALUES ($1, $2, $3, $4)', [userId, kind, granted, version]);
  }
  async list(userId: string): Promise<{ kind: string; granted: boolean; version: string; at: Date }[]> {
    return this.sql.query('SELECT kind, granted, version, at FROM consents WHERE user_id = $1 ORDER BY at', [userId]);
  }
}

class SqlAudit implements AuditRepository {
  constructor(private readonly sql: Sql) {}
  async log(orgId: string, actorId: string, action: string, data: Record<string, unknown>): Promise<void> {
    await this.sql.query('INSERT INTO audit_log (org_id, actor_id, action, data) VALUES ($1, $2, $3, $4)', [orgId, actorId, action, JSON.stringify(data)]);
  }
}

function repositories(sql: Sql): Repositories {
  return {
    users: new SqlUsers(sql),
    sessions: new SqlSessions(sql),
    orgs: new SqlOrgs(sql),
    spaces: new SqlSpaces(sql),
    consents: new SqlConsents(sql),
    audit: new SqlAudit(sql),
  };
}

export class SqlUnitOfWork implements UnitOfWork {
  constructor(private readonly db: Database) {}
  run<T>(fn: (r: Repositories) => Promise<T>): Promise<T> {
    return this.db.tx((sql) => fn(repositories(sql)));
  }
  tenant<T>(orgId: string, fn: (r: Repositories) => Promise<T>): Promise<T> {
    return this.db.tenant(orgId, (sql) => fn(repositories(sql)));
  }
}
