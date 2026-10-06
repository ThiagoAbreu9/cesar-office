/** Configuração por ambiente, validada na subida. */
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

const Env = z
  .object({
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().int().min(0).max(65535).default(4000),
    DATABASE_URL: z.string().url(),
    ACCESS_TOKEN_SECRET: z.string().min(32, 'ACCESS_TOKEN_SECRET precisa de ≥ 32 caracteres'),
    /** O MESMO segredo configurado no realtime. */
    TICKET_SECRET: z.string().min(32, 'TICKET_SECRET precisa de ≥ 32 caracteres'),
    REALTIME_PUBLIC_URL: z.string().regex(/^wss?:\/\//, 'REALTIME_PUBLIC_URL deve começar com ws:// ou wss://'),
    CORS_ORIGINS: z
      .string()
      .default('http://localhost:5173')
      .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
    COOKIE_SECURE: bool,
    AUTH_DEV_LOGIN: bool,
  })
  .superRefine((e, ctx) => {
    if (e.NODE_ENV === 'production' && e.AUTH_DEV_LOGIN) ctx.addIssue({ code: 'custom', message: 'AUTH_DEV_LOGIN é proibido em produção' });
    if (e.NODE_ENV === 'production' && !e.COOKIE_SECURE) ctx.addIssue({ code: 'custom', message: 'COOKIE_SECURE=true é obrigatório em produção' });
    if (e.NODE_ENV === 'production' && e.REALTIME_PUBLIC_URL.startsWith('ws://')) ctx.addIssue({ code: 'custom', message: 'Use wss:// em produção' });
    if (e.ACCESS_TOKEN_SECRET === e.TICKET_SECRET) ctx.addIssue({ code: 'custom', message: 'ACCESS_TOKEN_SECRET e TICKET_SECRET devem ser diferentes' });
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) throw new Error(`Configuração inválida:\n${r.error.issues.map((i) => `- ${i.path.join('.') || 'env'}: ${i.message}`).join('\n')}`);
  return r.data;
}
