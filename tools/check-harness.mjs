#!/usr/bin/env node
// Repo-wide harness guard. Enforces the AGENTS.md rules that no single
// package owns. Package-local rules are proved by vitest instead:
//   packages/sources/src/authority.test.ts  — adapters have zero db imports
//   packages/db/src/schema.test.ts          — money columns are numeric
//
// Exits non-zero on any violation so CI and the pre-commit hook fail loudly.

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const violations = [];

const fail = (rule, file, detail) => {
  violations.push({ rule, file: path.relative(repoRoot, file).split(path.sep).join('/'), detail });
};

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return entry.name === 'node_modules' || entry.name.startsWith('.') ? [] : walk(full);
    }
    return entry.name.endsWith('.ts') || entry.name.endsWith('.mjs') ? [full] : [];
  });
}

const packagesDir = path.join(repoRoot, 'packages');
const packageNames = existsSync(packagesDir)
  ? readdirSync(packagesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : [];

// ---------------------------------------------------------------------------
// Rule 1 — No floating point anywhere in the data path.
// ---------------------------------------------------------------------------
const FLOAT_PATTERNS = [
  [/\bparseFloat\s*\(/, 'parseFloat() drops precision; use parseDecimal() from @vaultbench/shared'],
  [/\bNumber\.parseFloat\s*\(/, 'Number.parseFloat() drops precision; use parseDecimal()'],
  [/\.toNumber\s*\(\s*\)/, 'Decimal.toNumber() leaks a float; use toNumericString()'],
  [/\bdoublePrecision\s*\(/, 'double precision cannot represent money; use numeric()'],
  [/\breal\s*\(\s*['"]/, 'real cannot represent money; use numeric()'],
];

// ---------------------------------------------------------------------------
// Rule 2 — Never hardcode credentials or API keys.
// ---------------------------------------------------------------------------
const SECRET_PATTERNS = [
  [/postgres(?:ql)?:\/\/[^'"\s]*:[^'"@\s]+@/, 'hardcoded database credential; read DATABASE_URL from the environment'],
  [/\b(?:api[_-]?key|apikey|secret|token|password|passwd)\s*[:=]\s*['"][^'"]{8,}['"]/i, 'hardcoded secret literal; load it from the environment'],
];

// ---------------------------------------------------------------------------
// Rule 3 — Database writes are strictly scoped.
// ---------------------------------------------------------------------------
const DB_MODULES = ['@vaultbench/db', 'drizzle-orm', 'drizzle-kit', 'postgres', 'pg'];
// `ingest` owns the raw tables; `compute` owns the derived ones and is held to
// that by the derived-writes-only rule below.
const DB_WRITE_PACKAGES = new Set(['db', 'ingest', 'compute']);
// Read-only consumers. They may open a database handle and select from it, but
// a write from a package that serves HTTP is how a read path silently becomes
// a write path. Held to that by the read-only-consumers rule below.
const DB_READ_PACKAGES = new Set(['api', 'mcp']);
const DB_ALLOWED_PACKAGES = new Set([...DB_WRITE_PACKAGES, ...DB_READ_PACKAGES]);

const ALL_TABLES = [
  'entities',
  'entitySnapshots',
  'depositors',
  'benchmarkPrices',
  'entityMetadataHistory',
  'ingestRuns',
  'entityFlows',
  'entityNav',
  'entityMetrics',
  'metricDefinitions',
];

// ---------------------------------------------------------------------------
// Rule 4 — packages/core performs zero I/O.
//
// Load-bearing, not stylistic: the maths has to be shared unchanged by the
// recompute job, the API and the MCP server, and has to be testable against
// fixtures. One fetch or one database handle in here and all three lose that.
// ---------------------------------------------------------------------------
const CORE_ALLOWED_IMPORTS = new Set(['decimal.js', '@vaultbench/shared/decimal', 'vitest']);

// ---------------------------------------------------------------------------
// Rule 4b - Float32 quarantine.
//
// `@vaultbench/shared/float32` is a deliberate, documented concession to one
// venue: the Enzyme API declares every numeric field as a 32-bit protobuf
// float, so its numbers arrive already lossy and there is no keyless
// alternative. The module's job is to get off the float at the boundary
// without inventing the digits a double would add.
//
// Left unguarded, it is a general-purpose exemption from "no floating point in
// the data path" that any future adapter could reach for instead of asking the
// venue for a string. Only the adapter that is actually forced may import it.
// ---------------------------------------------------------------------------
const FLOAT32_MODULE = '@vaultbench/shared/float32';
const FLOAT32_ALLOWED_PREFIX = 'sources/src/enzyme/';
const IO_GLOBALS = [
  [/\bfetch\s*\(/, 'fetch() is I/O; core takes data as arguments'],
  [/\bprocess\.env\b/, 'reading the environment is I/O; pass configuration in'],
  [/\bnew Date\s*\(\s*\)/, 'reading the clock makes the maths untestable; pass the date in'],
  [/\bDate\.now\s*\(/, 'reading the clock makes the maths untestable; pass the date in'],
];

// ---------------------------------------------------------------------------
// Rule 5 — Derived writes only.
//
// AGENTS.md grants `compute` write authority over derived tables alone. The
// raw archive is append-only and belongs to `ingest`; a recompute that could
// rewrite a snapshot would destroy the one asset that cannot be rebuilt.
// ---------------------------------------------------------------------------
const RAW_TABLES = [
  'entities',
  'entitySnapshots',
  'depositors',
  'benchmarkPrices',
  'entityMetadataHistory',
];
const MUTATIONS = ['insert', 'update', 'delete'];

const importSpecifiers = (code) => {
  const found = [];
  for (const pattern of [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ]) {
    for (const match of code.matchAll(pattern)) found.push(match[1]);
  }
  return found;
};

const scanTargets = [
  ...packageNames.flatMap((name) => [
    ...walk(path.join(packagesDir, name, 'src')),
    ...walk(path.join(packagesDir, name)).filter((file) => file.endsWith('.config.ts')),
  ]),
  ...walk(path.join(repoRoot, 'tools')),
];

for (const file of [...new Set(scanTargets)]) {
  const code = readFileSync(file, 'utf8');
  const isTest = file.endsWith('.test.ts');
  const isGuard = file.endsWith('check-harness.mjs');
  const relative = path.relative(packagesDir, file).split(path.sep).join('/');
  const owningPackage = relative.startsWith('..') ? null : relative.split('/')[0];

  // The guard and the proof tests name these patterns as string literals.
  if (!isGuard && !isTest) {
    for (const [pattern, detail] of FLOAT_PATTERNS) {
      if (pattern.test(code)) fail('no-floating-point', file, detail);
    }
  }

  if (!isGuard) {
    for (const [pattern, detail] of SECRET_PATTERNS) {
      if (pattern.test(code)) fail('no-hardcoded-secrets', file, detail);
    }
  }

  if (!isGuard && !isTest && owningPackage && !DB_ALLOWED_PACKAGES.has(owningPackage)) {
    for (const specifier of importSpecifiers(code)) {
      const root = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : specifier.split('/')[0];
      if (DB_MODULES.includes(root)) {
        fail(
          'scoped-db-writes',
          file,
          `package "${owningPackage}" is not authorized to import ${specifier}`,
        );
      }
    }
  }

  if (!isGuard && !relative.startsWith('shared/src/float32')) {
    for (const specifier of importSpecifiers(code)) {
      if (specifier !== FLOAT32_MODULE) continue;
      if (relative.startsWith(FLOAT32_ALLOWED_PREFIX)) continue;
      fail(
        'float32-quarantine',
        file,
        `${FLOAT32_MODULE} is quarantined to ${FLOAT32_ALLOWED_PREFIX}; ` +
          'parse the source as a decimal string instead of a float',
      );
    }
  }

  if (!isGuard && owningPackage === 'core') {
    for (const specifier of importSpecifiers(code)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) continue;
      if (CORE_ALLOWED_IMPORTS.has(specifier)) continue;
      fail('core-zero-io', file, `core may not import ${specifier}`);
    }
    if (!isTest) {
      for (const [pattern, detail] of IO_GLOBALS) {
        if (pattern.test(code)) fail('core-zero-io', file, detail);
      }
    }
  }

  if (!isGuard && !isTest && owningPackage === 'compute') {
    for (const table of RAW_TABLES) {
      for (const mutation of MUTATIONS) {
        // e.g. `.insert(entitySnapshots)` — a write against a raw table.
        const pattern = new RegExp(`\\.${mutation}\\s*\\(\\s*${table}\\b`);
        if (pattern.test(code)) {
          fail(
            'derived-writes-only',
            file,
            `compute may not ${mutation} ${table}; raw tables belong to ingest`,
          );
        }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Rule 7 — Read-only consumers stay read-only.
  //
  // `api` and `mcp` are public read surfaces. Nothing they serve should be
  // able to mutate a table, and "nobody would write that" is not a control.
  // ---------------------------------------------------------------------------
  if (!isGuard && !isTest && owningPackage && DB_READ_PACKAGES.has(owningPackage)) {
    for (const table of ALL_TABLES) {
      for (const mutation of MUTATIONS) {
        const pattern = new RegExp(`\\.${mutation}\\s*\\(\\s*${table}\\b`);
        if (pattern.test(code)) {
          fail(
            'read-only-consumers',
            file,
            `"${owningPackage}" is a read surface and may not ${mutation} ${table}`,
          );
        }
      }
    }
    for (const pattern of [/\bexecute\s*\(\s*sql`\s*(?:insert|update|delete|truncate|drop|alter)/i]) {
      if (pattern.test(code)) {
        fail('read-only-consumers', file, `"${owningPackage}" may not execute a mutating statement`);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rule 6 — The harness documents itself.
// ---------------------------------------------------------------------------
for (const required of ['AGENTS.md', 'docs/traps.md']) {
  const full = path.join(repoRoot, required);
  if (!existsSync(full)) fail('harness-present', full, 'required harness document is missing');
}

// ---------------------------------------------------------------------------
const RULE_ORDER = [
  'no-floating-point',
  'no-hardcoded-secrets',
  'scoped-db-writes',
  'core-zero-io',
  'derived-writes-only',
  'read-only-consumers',
  'harness-present',
];

// ---------------------------------------------------------------------------
// Rule 2b - No populated secrets in a committed example file.
//
// The no-hardcoded-secrets scan above only reads TypeScript, and this gap was
// found the hard way: a real Enzyme API key was pasted into `.env.example` on
// the commented `# ENZYME_API_KEY=` line, one `git add -A` away from being
// published, and every check in this file passed.
//
// `.env.example` exists in order to be committed, so every assignment in it
// must be empty or an obvious placeholder. Real values belong in `.env`,
// which is gitignored.
// ---------------------------------------------------------------------------
const EXAMPLE_ENV = path.join(repoRoot, '.env.example');

/**
 * Detected by variable *name*, not by the shape of the value.
 *
 * Guessing from the value was the first attempt and it was wrong in both
 * directions: it flagged `S3_REGION=auto` and `S3_FORCE_PATH_STYLE=true`,
 * which are documentation, while any rule loose enough to let those through
 * would also let through a short API key. The name is the reliable signal —
 * a variable called `*_KEY` has no business carrying a value in a file whose
 * entire purpose is to be committed.
 */
const SECRET_NAME = /(?:_KEY|_KEY_ID|_TOKEN|_SECRET|SECRET_|PASSWORD|PASSWD|_CREDENTIALS?)$|^(?:.*_)?(?:APIKEY|TOKEN|SECRET)$/;

/** A connection string with an embedded password pointing somewhere real. */
const REMOTE_CREDENTIAL_URL = /^[a-z][a-z0-9+.-]*:\/\/[^:@\s/]+:[^@\s/]+@([^/:\s]+)/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db', 'host.docker.internal']);

if (existsSync(EXAMPLE_ENV)) {
  readFileSync(EXAMPLE_ENV, 'utf8')
    .split(/\r?\n/)
    .forEach((line, index) => {
      // Commented-out settings count. That is exactly where the key landed:
      // pasted onto the `# ENZYME_API_KEY=` line, still committable.
      const match = /^\s*#?\s*([A-Z][A-Z0-9_]*)\s*=(.*)$/.exec(line);
      if (match === null) return;
      const name = match[1] ?? '';
      const value = (match[2] ?? '').trim();
      if (value === '') return;

      const where = `line ${index + 1}: ${name}`;
      if (SECRET_NAME.test(name)) {
        fail(
          'no-hardcoded-secrets',
          EXAMPLE_ENV,
          `${where} carries a value in a committed file; real secrets go in .env, ` +
            'which is gitignored, and the example line stays empty',
        );
        return;
      }

      // A local throwaway default is the point of an example file; a
      // credential for a host someone can actually reach is not.
      const url = REMOTE_CREDENTIAL_URL.exec(value);
      if (url !== null && !LOCAL_HOSTS.has(url[1] ?? '')) {
        fail(
          'no-hardcoded-secrets',
          EXAMPLE_ENV,
          `${where} embeds a password for non-local host "${url[1]}"; ` +
            'the example may only default to a local service',
        );
      }
    });
}

if (violations.length === 0) {
  console.log(`harness: OK — ${scanTargets.length} files checked, 0 violations`);
  process.exit(0);
}

console.error(`harness: FAILED — ${violations.length} violation(s)\n`);
for (const rule of RULE_ORDER) {
  const forRule = violations.filter((violation) => violation.rule === rule);
  if (forRule.length === 0) continue;
  console.error(`  ${rule}`);
  for (const { file, detail } of forRule) console.error(`    ${file}: ${detail}`);
  console.error('');
}
console.error('See AGENTS.md for the rule these violate.');
process.exit(1);
