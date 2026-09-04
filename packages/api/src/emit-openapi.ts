import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { specOf } from './spec.js';

/**
 * Write the spec to disk without a database.
 *
 * The plan calls for `/openapi.json` "from day one", and a spec that can only
 * be obtained by booting a server against Postgres is one that never gets
 * reviewed in a diff. This makes the contract a checked-in artifact, so a
 * breaking change to a response shape shows up in code review.
 */
const out = fileURLToPath(new URL('../../../docs/openapi.json', import.meta.url));
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(specOf(), null, 2)}\n`, 'utf8');
console.log(`wrote ${path.relative(process.cwd(), out)}`);
