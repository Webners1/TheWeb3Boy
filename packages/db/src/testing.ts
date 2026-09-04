import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Test-only migration runner. Kept in `packages/db` so every package that
 * spins up a throwaway database applies the *whole* migration history rather
 * than pinning one filename and silently drifting when a table is added.
 *
 * Deliberately structural in its client type: this module must not pull PGlite
 * into `packages/db`'s dependency graph.
 */
export interface SqlExecutor {
  exec(sql: string): Promise<unknown>;
}

const migrationsDir = fileURLToPath(new URL('../migrations/', import.meta.url));

export function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith('.sql'))
    .sort();
}

/**
 * Apply every migration in order.
 *
 * PGlite has no BRIN access method, so the BRIN indexes we want in production
 * are created as btree in tests. That changes the plan, never the results.
 */
export async function applyMigrations(client: SqlExecutor): Promise<void> {
  for (const name of migrationFiles()) {
    const sql = readFileSync(`${migrationsDir}${name}`, 'utf8')
      .replaceAll('--> statement-breakpoint', '')
      .replaceAll('USING brin', 'USING btree');
    await client.exec(sql);
  }
}
