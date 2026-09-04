import { mkdtempSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LocalFileArchive, resolveArchiveRoot } from './storage.js';

describe('resolveArchiveRoot', () => {
  const originalCwd = process.cwd();
  let workspace: string;

  beforeEach(() => {
    // A fake workspace with a nested package, mirroring the real layout.
    workspace = mkdtempSync(path.join(tmpdir(), 'vaultbench-ws-'));
    writeFileSync(path.join(workspace, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    mkdirSync(path.join(workspace, 'packages', 'ingest'), { recursive: true });
  });

  afterEach(() => {
    process.chdir(originalCwd);
  });

  it('resolves a relative root against the workspace, not the package', () => {
    // The bug this exists for: pnpm runs each package's script with that
    // package as the cwd, so `./var/archive` became
    // packages/ingest/var/archive for the daily job and
    // packages/backfill/var/archive for the backfill — two archives, neither
    // where the documentation says, splitting append-only ground truth.
    process.chdir(path.join(workspace, 'packages', 'ingest'));
    expect(resolveArchiveRoot('./var/archive')).toBe(path.join(workspace, 'var', 'archive'));
  });

  it('gives every package the same answer', () => {
    mkdirSync(path.join(workspace, 'packages', 'backfill'), { recursive: true });

    process.chdir(path.join(workspace, 'packages', 'ingest'));
    const fromIngest = resolveArchiveRoot('./var/archive');
    process.chdir(path.join(workspace, 'packages', 'backfill'));
    const fromBackfill = resolveArchiveRoot('./var/archive');
    process.chdir(workspace);
    const fromRoot = resolveArchiveRoot('./var/archive');

    expect(fromIngest).toBe(fromBackfill);
    expect(fromIngest).toBe(fromRoot);
  });

  it('leaves an absolute root alone', () => {
    process.chdir(path.join(workspace, 'packages', 'ingest'));
    const absolute = path.join(workspace, 'elsewhere');
    expect(resolveArchiveRoot(absolute)).toBe(absolute);
  });

  it('defaults to the workspace archive when unset', () => {
    process.chdir(path.join(workspace, 'packages', 'ingest'));
    expect(resolveArchiveRoot(undefined)).toBe(path.join(workspace, 'var', 'archive'));
  });
});

describe('LocalFileArchive', () => {
  it('never overwrites an existing payload', async () => {
    // Raw data is append-only. Re-running a day must leave the original
    // gzipped payload untouched, because it is the only record of what the
    // venue actually said at the time.
    const root = mkdtempSync(path.join(tmpdir(), 'vaultbench-archive-'));
    const archive = new LocalFileArchive(root);

    expect(await archive.put('raw/enzyme/2026-09-04/a.json', 'first')).toBe('written');
    expect(await archive.put('raw/enzyme/2026-09-04/a.json', 'second')).toBe('exists');
    expect(readFileSync(path.join(root, 'raw/enzyme/2026-09-04/a.json'), 'utf8')).toBe('first');
  });

  it('refuses a key that escapes the archive root', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'vaultbench-archive-'));
    const archive = new LocalFileArchive(root);
    await expect(archive.put('../escaped.json', 'x')).rejects.toThrow(/escapes root/);
  });
});
