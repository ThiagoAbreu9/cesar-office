/**
 * Ticket de entrada (02 §4.1): JWT HS256 de 30 s, uso único (nonce `jti`).
 * Implementado com node:crypto — sem dependência — e com comparação em tempo constante.
 *
 * O nonce fica em memória neste nó; com vários nós, `NonceStore` passa a ser Redis (`SET NX EX 30`).
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { PresenceStatus } from '@cesar-office/protocol';
import type { TicketClaims, TicketVerifier } from '../application/ports.ts';

const b64url = (b: Buffer | string): string => Buffer.from(b).toString('base64url');

const ClaimsSchema = z.object({
  sub: z.string().uuid(),
  org: z.string().uuid(),
  spc: z.string().uuid(),
  ins: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  map: z.string().min(1).max(64).regex(/^[a-zA-Z0-9_-]+$/),
  rol: z.enum(['owner', 'admin', 'member']),
  nam: z.string().min(1).max(40),
  lok: z.object({ body: z.number().int().min(0).max(15), hair: z.number().int().min(0).max(15), outfit: z.number().int().min(0).max(15) }),
  sts: PresenceStatus,
  pos: z.object({ x: z.number().int().min(0).max(65535), y: z.number().int().min(0).max(65535) }).optional(),
  jti: z.string().min(16).max(64),
  exp: z.number().int(),
  iat: z.number().int(),
});

export interface NonceStore {
  /** true se o nonce era novo (e agora está consumido). */
  consume(nonce: string, ttlMs: number, now: number): Promise<boolean>;
}

export class InMemoryNonceStore implements NonceStore {
  private readonly seen = new Map<string, number>();
  async consume(nonce: string, ttlMs: number, now: number): Promise<boolean> {
    if (this.seen.size > 10_000) for (const [k, exp] of this.seen) if (exp < now) this.seen.delete(k);
    const exp = this.seen.get(nonce);
    if (exp !== undefined && exp >= now) return false;
    this.seen.set(nonce, now + ttlMs);
    return true;
  }
}

export interface TicketOptions {
  readonly secret: string;
  readonly ttlMs?: number;
  readonly now?: () => number;
}

export class HmacTicketCodec implements TicketVerifier {
  private readonly key: Buffer;
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(opts: TicketOptions, private readonly nonces: NonceStore = new InMemoryNonceStore()) {
    if (opts.secret.length < 32) throw new Error('TICKET_SECRET precisa de ≥ 32 caracteres');
    this.key = Buffer.from(opts.secret, 'utf8');
    this.ttlMs = opts.ttlMs ?? 30_000;
    this.now = opts.now ?? Date.now;
  }

  /** Usado pela API (e por testes/ferramentas de dev). */
  sign(c: TicketClaims & { readonly spaceId: string }): string {
    const iat = Math.floor(this.now() / 1000);
    const payload = {
      sub: c.userId,
      org: c.orgId,
      spc: c.spaceId,
      ins: c.instanceId,
      map: c.mapId,
      rol: c.role,
      nam: c.displayName,
      lok: c.look,
      sts: c.status,
      ...(c.lastPosition ? { pos: c.lastPosition } : {}),
      jti: randomBytes(16).toString('base64url'),
      iat,
      exp: iat + Math.ceil(this.ttlMs / 1000),
    };
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify(payload));
    return `${head}.${body}.${this.mac(`${head}.${body}`)}`;
  }

  async verify(ticket: string): Promise<TicketClaims | null> {
    const parts = ticket.split('.');
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts as [string, string, string];
    const expected = Buffer.from(this.mac(`${head}.${body}`));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;

    let header: unknown;
    let raw: unknown;
    try {
      header = JSON.parse(Buffer.from(head, 'base64url').toString('utf8'));
      raw = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
      return null;
    }
    if (typeof header !== 'object' || header === null || (header as { alg?: unknown }).alg !== 'HS256') return null;
    const parsed = ClaimsSchema.safeParse(raw);
    if (!parsed.success) return null;
    const c = parsed.data;
    const now = this.now();
    if (c.exp * 1000 < now) return null;
    if (!(await this.nonces.consume(c.jti, this.ttlMs + 5_000, now))) return null; // replay

    return {
      userId: c.sub,
      orgId: c.org,
      spaceId: c.spc,
      instanceId: c.ins,
      mapId: c.map,
      role: c.rol,
      displayName: c.nam,
      look: c.lok,
      status: c.sts,
      ...(c.pos ? { lastPosition: c.pos } : {}),
    };
  }

  private mac(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }
}
