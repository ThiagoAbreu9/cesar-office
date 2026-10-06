/** Aplica as migrações pendentes. Rode com o usuário DONO do esquema (não o da aplicação). */
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { migrate } from './infrastructure/database.ts';

const url = process.env['MIGRATION_DATABASE_URL'] ?? process.env['DATABASE_URL'];
if (!url) throw new Error('Defina MIGRATION_DATABASE_URL (ou DATABASE_URL)');

const client = new pg.Client({ connectionString: url });
await client.connect();
try {
  const applied = await migrate(
    (sql) => client.query(sql),
    async (text, params = []) => (await client.query(text, params as unknown[])).rows,
    fileURLToPath(new URL('../migrations', import.meta.url)),
  );
  console.log(applied.length ? `Aplicadas: ${applied.join(', ')}` : 'Nada a aplicar');
} finally {
  await client.end();
}
