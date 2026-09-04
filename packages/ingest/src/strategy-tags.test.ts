import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';

import {
  loadStrategyTags,
  resetStrategyTags,
  strategyCategoryFor,
  strategyKey,
} from './strategy-tags.js';

function writeTags(contents: unknown): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'vaultbench-tags-'));
  const file = path.join(dir, 'strategy-tags.json');
  writeFileSync(file, JSON.stringify(contents), 'utf8');
  return file;
}

beforeEach(() => {
  resetStrategyTags();
});

describe('strategy tags', () => {
  it('reads the checked-in file so a tag is a reviewable diff', () => {
    // The real repo file, not a fixture: if it stops parsing, ingest breaks.
    expect(loadStrategyTags().size).toBeGreaterThan(0);
  });

  it('resolves a tag by source and external id', () => {
    const file = writeTags({ tags: { 'hyperliquid:0xabc': 'neutral' } });
    expect(strategyCategoryFor('hyperliquid', '0xabc', file)).toBe('neutral');
  });

  it('leaves an untagged entity null rather than guessing a category', () => {
    const file = writeTags({ tags: {} });
    expect(strategyCategoryFor('okx', 'swap:123', file)).toBeNull();
  });

  it('rejects a category outside the three defined ones', () => {
    // A typo that silently became null would mislabel a vault forever.
    const file = writeTags({ tags: { 'hyperliquid:0xabc': 'directionl' } });
    expect(() => loadStrategyTags(file)).toThrow();
  });

  it('treats an absent file as nothing tagged yet', () => {
    const file = path.join(tmpdir(), 'vaultbench-tags-does-not-exist.json');
    expect(loadStrategyTags(file).size).toBe(0);
  });

  it('builds the composite key the file is written against', () => {
    expect(strategyKey('chamber', 'polygon:0xabc')).toBe('chamber:polygon:0xabc');
  });
});
