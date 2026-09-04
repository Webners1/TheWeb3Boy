import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Load a local `.env` if present, without overwriting values already in the
 * environment (CI / GitHub Actions win).
 */
export function loadDotEnv(cwd = process.cwd()): void {
  const file = path.join(cwd, '.env');
  if (!existsSync(file)) return;

  const text = readFileSync(file, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}
