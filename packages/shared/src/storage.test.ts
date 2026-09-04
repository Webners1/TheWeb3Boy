import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { LocalFileArchive } from './storage.js';

describe('LocalFileArchive', () => {
  it('refuses to overwrite an existing payload', async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), 'vaultbench-archive-'));
    const archive = new LocalFileArchive(dir);
    const first = await archive.put('raw/hl/2026-09-04/vaults.json.gz', 'one');
    const second = await archive.put('raw/hl/2026-09-04/vaults.json.gz', 'two');
    expect(first).toBe('written');
    expect(second).toBe('exists');
    const stored = await readFile(path.join(dir, 'raw/hl/2026-09-04/vaults.json.gz'), 'utf8');
    expect(stored).toBe('one');
  });
});
