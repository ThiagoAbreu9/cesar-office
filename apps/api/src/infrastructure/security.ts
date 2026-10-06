/**
 * Access token (JWT HS256, 15 min) e diretório de instâncias de nó único.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { AccessTokens, Clock, InstanceDirectory } from '../application/ports.ts';

const b64 = (s: string | Buffer): string => Buffer.from(s).toString('base64url');

export class HmacAccessTokens implements AccessTokens {
  private readonly key: Buffer;

  constructor(
    secret: string,
    private readonly clock: Clock,
    private readonly ttlSeconds = 15 * 60,
    private readonly issuer = 'cesar-office-api',
  ) {
    if (secret.length < 32) throw new Error('ACCESS_TOKEN_SECRET precisa de ≥ 32 caracteres');
    this.key = Buffer.from(secret, 'utf8');
  }

  sign(userId: string): { token: string; expiresAt: Date } {
    const iat = Math.floor(this.clock.now().getTime() / 1000);
    const exp = iat + this.ttlSeconds;
    const head = b64(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64(JSON.stringify({ sub: userId, iss: this.issuer, iat, exp }));
    return { token: `${head}.${body}.${this.mac(`${head}.${body}`)}`, expiresAt: new Date(exp * 1000) };
  }

  verify(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [head, body, sig] = parts as [string, string, string];
    const a = Buffer.from(this.mac(`${head}.${body}`));
    const b = Buffer.from(sig);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    try {
      const h = JSON.parse(Buffer.from(head, 'base64url').toString()) as { alg?: unknown };
      const p = JSON.parse(Buffer.from(body, 'base64url').toString()) as { sub?: unknown; iss?: unknown; exp?: unknown };
      if (h.alg !== 'HS256' || p.iss !== this.issuer || typeof p.sub !== 'string' || typeof p.exp !== 'number') return null;
      if (p.exp * 1000 <= this.clock.now().getTime()) return null;
      return p.sub;
    } catch {
      return null;
    }
  }

  private mac(data: string): string {
    return createHmac('sha256', this.key).update(data).digest('base64url');
  }
}

/**
 * MVP: um nó realtime. Instância determinística por (org, espaço, mapa), assim todos do mesmo
 * espaço caem juntos. V1: diretório no Redis com shards por lotação (02 §5.2).
 */
export class SingleNodeDirectory implements InstanceDirectory {
  constructor(private readonly wsUrl: string) {}

  async locate(orgId: string, spaceId: string, assetKey: string): Promise<{ instanceId: string; wsUrl: string }> {
    const h = createHash('sha256').update(`${orgId}:${spaceId}`).digest('hex').slice(0, 16);
    return { instanceId: `i_${h}_${assetKey}`.slice(0, 64), wsUrl: this.wsUrl };
  }
}

export const systemClock: Clock = { now: () => new Date() };
