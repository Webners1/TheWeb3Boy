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
const DB_ALLOWED_PACKAGES = new Set(['db', 'ingest', 'backfill']);

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
}

// ---------------------------------------------------------------------------
// Rule 4 — The harness documents itself.
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
  'harness-present',
];

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
