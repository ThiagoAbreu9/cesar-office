/** Configuração por variáveis de ambiente, validada na subida (falha cedo, com mensagem clara). */
import { z } from 'zod';

const csv = z
  .string()
  .default('')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const Env = z
  .object({
    PORT: z.coerce.number().int().min(0).max(65535).default(4100),
    TICKET_SECRET: z.string().min(32, 'TICKET_SECRET precisa de ≥ 32 caracteres'),
    ALLOWED_ORIGINS: csv,
    MAPS_DIR: z.string().default('../../packages/world/maps'),
    MAPS_PUBLIC_URL: z.string().url().default('http://localhost:5173/maps'),
    MAX_INSTANCE_CCU: z.coerce.number().int().min(1).max(1000).default(150),
    LIVEKIT_URL: z.string().url().optional(),
    LIVEKIT_API_URL: z.string().url().optional(),
    LIVEKIT_API_KEY: z.string().optional(),
    LIVEKIT_API_SECRET: z.string().optional(),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  })
  .superRefine((e, ctx) => {
    const lk = [e.LIVEKIT_URL, e.LIVEKIT_API_URL, e.LIVEKIT_API_KEY, e.LIVEKIT_API_SECRET];
    if (lk.some(Boolean) && !lk.every(Boolean)) ctx.addIssue({ code: 'custom', message: 'Defina todas as LIVEKIT_* ou nenhuma' });
    if (e.NODE_ENV === 'production' && e.ALLOWED_ORIGINS.length === 0) ctx.addIssue({ code: 'custom', message: 'ALLOWED_ORIGINS é obrigatório em produção' });
  });

export type Config = z.infer<typeof Env>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const r = Env.safeParse(env);
  if (!r.success) {
    const lines = r.error.issues.map((i) => `- ${i.path.join('.') || 'env'}: ${i.message}`);
    throw new Error(`Configuração inválida:\n${lines.join('\n')}`);
  }
  return r.data;
}
