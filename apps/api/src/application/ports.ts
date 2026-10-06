/**
 * Portas da aplicação. SQL, JWT e diretório de instâncias são detalhes de infraestrutura.
 */
import type { AvatarLook } from '@cesar-office/protocol';
import type { TicketClaims } from '@cesar-office/ticket';
import type { Member, MapRef, Organization, Role, Space, User } from '../domain/model.ts';

export interface Clock {
  now(): Date;
}

export interface AccessTokens {
  /** JWT curto (15 min) com `sub` = userId. Papéis NÃO vão no token: são lidos do banco a cada requisição. */
  sign(userId: string): { token: string; expiresAt: Date };
  verify(token: string): string | null;
}

export interface TicketSigner {
  sign(claims: TicketClaims): string;
  readonly ttlSeconds: number;
}

/** Onde roda a instância do mapa (02 §5.2). MVP: um nó; V1: diretório no Redis. */
export interface InstanceDirectory {
  locate(orgId: string, spaceId: string, assetKey: string): Promise<{ instanceId: string; wsUrl: string }>;
}

// ───────────────────────────── repositórios ─────────────────────────────

export interface UserRepository {
  findById(id: string): Promise<User | null>;
  findByEmail(email: string): Promise<User | null>;
  create(input: { email: string; displayName: string }): Promise<User>;
  updateProfile(id: string, patch: { displayName?: string; avatar?: AvatarLook }): Promise<User>;
  /** LGPD: apaga dados pessoais e mantém o id (mensagens passam a "Usuário removido"). */
  anonymize(id: string): Promise<void>;
}

export interface SessionRecord {
  readonly id: string;
  readonly userId: string;
  readonly familyId: string;
  readonly expiresAt: Date;
  readonly replacedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface SessionRepository {
  create(input: { userId: string; familyId: string; tokenHash: Buffer; expiresAt: Date }): Promise<void>;
  findByHash(tokenHash: Buffer): Promise<SessionRecord | null>;
  /** Marca como substituído SE ainda estiver ativo. false = corrida/reuso. */
  markReplaced(id: string, at: Date): Promise<boolean>;
  revokeFamily(familyId: string, at: Date): Promise<void>;
  revokeAllForUser(userId: string, at: Date): Promise<void>;
}

export interface OrgRepository {
  createWithOwner(input: { name: string; slug: string; allowedEmailDomain: string | null }, ownerId: string): Promise<Organization>;
  findById(id: string): Promise<Organization | null>;
  slugExists(slug: string): Promise<boolean>;
  update(id: string, patch: { name?: string; allowedEmailDomain?: string | null; chatRetentionDays?: number }): Promise<Organization>;
  orgsOf(userId: string): Promise<{ org: Organization; role: Role }[]>;
  roleOf(orgId: string, userId: string): Promise<Role | null>;
  members(orgId: string, limit: number, after?: string): Promise<Member[]>;
  ownersCount(orgId: string): Promise<number>;
  addMember(orgId: string, userId: string, role: Role): Promise<void>;
  setRole(orgId: string, userId: string, role: Role): Promise<void>;
  removeMember(orgId: string, userId: string): Promise<void>;
  orgsAllowingDomain(domain: string): Promise<string[]>;
  invite(orgId: string, emails: readonly string[], role: Exclude<Role, 'owner'>, invitedBy: string): Promise<number>;
  /** Aceita todos os convites pendentes do e-mail (vira membro). Retorna as orgs. */
  acceptInvites(email: string, userId: string): Promise<string[]>;
}

export interface SpaceRepository {
  /** Cria o espaço e o mapa padrão. Precisa rodar dentro do tenant. */
  create(orgId: string, name: string, assetKey: string): Promise<Space>;
  list(orgId: string): Promise<Space[]>;
  findWithDefaultMap(orgId: string, spaceId: string): Promise<{ space: Space; map: MapRef } | null>;
  lastPosition(orgId: string, userId: string, spaceId: string): Promise<{ x: number; y: number } | null>;
}

export interface ConsentRepository {
  record(userId: string, kind: 'microphone' | 'terms' | 'privacy', granted: boolean, version: string): Promise<void>;
  list(userId: string): Promise<{ kind: string; granted: boolean; version: string; at: Date }[]>;
}

export interface AuditRepository {
  log(orgId: string, actorId: string, action: string, data: Record<string, unknown>): Promise<void>;
}

export interface Repositories {
  readonly users: UserRepository;
  readonly sessions: SessionRepository;
  readonly orgs: OrgRepository;
  readonly spaces: SpaceRepository;
  readonly consents: ConsentRepository;
  readonly audit: AuditRepository;
}

/** Unidade de trabalho: repositórios ligados a uma transação (e, se `orgId`, ao tenant). */
export interface UnitOfWork {
  run<T>(fn: (r: Repositories) => Promise<T>): Promise<T>;
  tenant<T>(orgId: string, fn: (r: Repositories) => Promise<T>): Promise<T>;
}
