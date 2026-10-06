/**
 * Acesso a dados: uma porta pequena (`Database`) com duas implementações —
 * `pg` (produção) e PGlite (testes com Postgres real em processo).
 *
 * `tenant(orgId, fn)` é o ÚNICO jeito de tocar tabelas com RLS: abre transação e define
 * `app.org_id` só para ela (`set_config(..., true)` = LOCAL). Sem isso, o RLS devolve zero linhas.
 */
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';

export interface Sql {
  query<R = Record<string, unknown>>(text: string, params?: readonly unknown[]): Promise<R[]>;
}

export interface Database extends Sql {
  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T>;
  tenant<T>(orgId: string, fn: (sql: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const SET_TENANT = "SELECT set_config('app.org_id', $1, true)";

export class PgDatabase implements Database {
  constructor(private readonly pool: pg.Pool) {}

  static connect(url: string, max = 10): PgDatabase {
    return new PgDatabase(new pg.Pool({ connectionString: url, max, statement_timeout: 5_000 }));
  }

  async query<R>(text: string, params: readonly unknown[] = []): Promise<R[]> {
    return (await this.pool.query(text, params as unknown[])).rows as R[];
  }

  async tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const sql: Sql = { query: async <R>(t: string, p: readonly unknown[] = []) => (await client.query(t, p as unknown[])).rows as R[] };
      const out = await fn(sql);
      await client.query('COMMIT');
      return out;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw e;
    } finally {
      client.release();
    }
  }

  tenant<T>(orgId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.tx(async (sql) => {
      await sql.query(SET_TENANT, [orgId]);
      return fn(sql);
    });
  }

  close(): Promise<void> {
    return this.pool.end();
  }
}

/** Interface mínima do PGlite usada aqui (evita acoplar o tipo da lib à camada de aplicação). */
export interface PgliteLike {
  query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }>;
  transaction<T>(fn: (tx: { query<R>(text: string, params?: unknown[]): Promise<{ rows: R[] }> }) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}

export class PgliteDatabase implements Database {
  constructor(readonly db: PgliteLike) {}

  async query<R>(text: string, params: readonly unknown[] = []): Promise<R[]> {
    return (await this.db.query<R>(text, [...params])).rows;
  }

  tx<T>(fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => fn({ query: async <R>(t: string, p: readonly unknown[] = []) => (await tx.query<R>(t, [...p])).rows }));
  }

  tenant<T>(orgId: string, fn: (sql: Sql) => Promise<T>): Promise<T> {
    return this.tx(async (sql) => {
      await sql.query(SET_TENANT, [orgId]);
      return fn(sql);
    });
  }

  close(): Promise<void> {
    return this.db.close();
  }
}

/** Aplica `migrations/*.sql` em ordem, cada uma numa transação, registrando em schema_migrations. */
export async function migrate(exec: (sql: string) => Promise<unknown>, query: Sql['query'], dir: string): Promise<string[]> {
  await exec('CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const done = new Set((await query<{ version: string }>('SELECT version FROM schema_migrations')).map((r) => r.version));
  const files = (await readdir(dir)).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const text = await readFile(join(dir, f), 'utf8');
    await exec(`BEGIN;\n${text}\nINSERT INTO schema_migrations(version) VALUES ('${f.replace(/'/g, "''")}');\nCOMMIT;`);
    applied.push(f);
  }
  return applied;
}
