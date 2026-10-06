/**
 * Domínio da API: tipos, erros e regras puras (sem banco, sem HTTP).
 */
import type { AvatarLook } from '@cesar-office/protocol';

export type Role = 'owner' | 'admin' | 'member';

export interface User {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly avatar: AvatarLook;
  readonly deletedAt: Date | null;
}

export interface Organization {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly allowedEmailDomain: string | null;
  readonly chatRetentionDays: number;
}

export interface Member {
  readonly userId: string;
  readonly email: string;
  readonly displayName: string;
  readonly role: Role;
  readonly joinedAt: Date;
}

export interface Space {
  readonly id: string;
  readonly orgId: string;
  readonly name: string;
}

export interface MapRef {
  readonly id: string;
  readonly assetKey: string;
  readonly version: number;
}

export type ErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict' | 'rate_limited';

/** Erro de negócio com código estável (vira problem+json na borda HTTP — 09 §1). */
export class AppError extends Error {
  override readonly name = 'AppError';
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const RANK: Record<Role, number> = { member: 1, admin: 2, owner: 3 };

export function isAtLeast(role: Role, min: Role): boolean {
  return RANK[role] >= RANK[min];
}

/**
 * Quem pode mudar o papel de quem:
 * - só admin/owner mudam papéis;
 * - só owner concede ou retira "owner";
 * - não se pode remover o último owner (a org ficaria sem dono).
 */
export function assertCanChangeRole(actor: Role, target: Role, next: Role, ownersCount: number): void {
  if (!isAtLeast(actor, 'admin')) throw new AppError('forbidden', 'Somente administradores mudam papéis');
  if ((target === 'owner' || next === 'owner') && actor !== 'owner') throw new AppError('forbidden', 'Somente o dono concede ou retira o papel de dono');
  if (target === 'owner' && next !== 'owner' && ownersCount <= 1) throw new AppError('conflict', 'A organização precisa de pelo menos um dono');
}

export function assertCanRemove(actor: Role, actorId: string, target: Role, targetId: string, ownersCount: number): void {
  const self = actorId === targetId;
  if (!self && !isAtLeast(actor, 'admin')) throw new AppError('forbidden', 'Somente administradores removem membros');
  if (!self && target === 'owner' && actor !== 'owner') throw new AppError('forbidden', 'Somente o dono remove outro dono');
  if (target === 'owner' && ownersCount <= 1) throw new AppError('conflict', 'A organização precisa de pelo menos um dono');
}

export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1).toLowerCase();
}

export function slugify(name: string): string {
  const base = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return base.length >= 3 ? base : `org-${base}`.padEnd(3, '0');
}
