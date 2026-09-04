import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fixturesRoot = fileURLToPath(new URL('../fixtures', import.meta.url));

export function loadFixture(relativePath: string): unknown {
  const full = path.join(fixturesRoot, relativePath);
  return JSON.parse(readFileSync(full, 'utf8')) as unknown;
}
