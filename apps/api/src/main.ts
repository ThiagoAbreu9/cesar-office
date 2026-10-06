/**
 * Composition root da API.
 *   node --experimental-transform-types src/migrate.ts   # uma vez por deploy (usuário dono do esquema)
 *   node --experimental-transform-types src/main.ts      # usuário da aplicação (membro de cesar_app)
 */
import { HmacTicketCodec } from '@cesar-office/ticket';
import { loadConfig } from './config.ts';
import { AccountService, AuthService, OrgService, SpaceService } from './application/services.ts';
import { PgDatabase } from './infrastructure/database.ts';
import { SqlUnitOfWork } from './infrastructure/sql-repositories.ts';
import { HmacAccessTokens, SingleNodeDirectory, systemClock } from './infrastructure/security.ts';
import { buildApp } from './interface/http.ts';

const cfg = loadConfig();
const db = PgDatabase.connect(cfg.DATABASE_URL);
const uow = new SqlUnitOfWork(db);
const access = new HmacAccessTokens(cfg.ACCESS_TOKEN_SECRET, systemClock);
const tickets = new HmacTicketCodec({ secret: cfg.TICKET_SECRET });

const app = await buildApp({
  auth: new AuthService(uow, access, systemClock),
  account: new AccountService(uow, systemClock),
  orgs: new OrgService(uow),
  spaces: new SpaceService(uow, tickets, new SingleNodeDirectory(cfg.REALTIME_PUBLIC_URL), systemClock),
  access,
  corsOrigins: cfg.CORS_ORIGINS,
  cookieSecure: cfg.COOKIE_SECURE,
  devLogin: cfg.AUTH_DEV_LOGIN,
  logger: true,
});

await app.listen({ port: cfg.PORT, host: '0.0.0.0' });
if (cfg.AUTH_DEV_LOGIN) app.log.warn('AUTH_DEV_LOGIN ativo: login sem senha por e-mail (somente desenvolvimento)');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.once(sig, () => {
    void app.close().then(() => db.close()).then(() => process.exit(0));
  });
}
