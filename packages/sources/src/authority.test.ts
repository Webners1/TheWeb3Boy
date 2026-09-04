import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

// Executable proof of AGENTS.md § Security & Authority:
//   "Adapters in `packages/sources` must have zero database imports."
// Prose in AGENTS.md cannot fail a build. This test can.

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const srcDir = path.join(packageRoot, 'src');

/** Modules an adapter is never allowed to reach for. */
const FORBIDDEN_MODULES = [
  '@vaultbench/db',
  'drizzle-orm',
  'drizzle-kit',
  'postgres',
  'pg',
];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    // Test files are not the data path; this file names the forbidden
    // modules as string literals and would otherwise flag itself.
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) return [];
    return [full];
  });
}

/** Specifiers of every static/dynamic import and require in a file. */
function importedModules(code: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s+['"]([^'"]+)['"]/g,
    /\bimport\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of code.matchAll(pattern)) {
      const specifier = match[1];
      if (specifier !== undefined) specifiers.push(specifier);
    }
  }
  return specifiers;
}

describe('packages/sources authority boundary', () => {
  it('has zero database imports in any adapter', () => {
    const violations: string[] = [];

    for (const file of sourceFiles(srcDir)) {
      const code = readFileSync(file, 'utf8');
      for (const specifier of importedModules(code)) {
        const root = specifier.startsWith('@')
          ? specifier.split('/').slice(0, 2).join('/')
          : specifier.split('/')[0];
        if (root !== undefined && FORBIDDEN_MODULES.includes(root)) {
          violations.push(`${path.relative(packageRoot, file)} imports ${specifier}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('declares no database package as a dependency', () => {
    const manifest = JSON.parse(
      readFileSync(path.join(packageRoot, 'package.json'), 'utf8'),
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };

    const declared = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
    ];

    expect(declared.filter((name) => FORBIDDEN_MODULES.includes(name))).toEqual([]);
  });
});
