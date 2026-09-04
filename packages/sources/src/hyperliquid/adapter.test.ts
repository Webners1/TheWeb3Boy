import { describe, expect, it } from 'vitest';

import { HyperliquidSource } from './adapter.js';
import { loadFixture } from '../load-fixture.js';

function fixtureFetch(url: string, options?: { method?: string; body?: unknown }): Promise<unknown> {
  const body = options?.body as { type?: string; vaultAddress?: string } | undefined;
  if (url.includes('/Mainnet/vaults')) {
    return Promise.resolve(loadFixture('hyperliquid/vaults.json'));
  }
  if (body?.type === 'vaultSummaries') {
    return Promise.resolve(loadFixture('hyperliquid/vaultSummaries.empty.json'));
  }
  if (body?.type === 'vaultDetails' && body.vaultAddress) {
    return Promise.resolve(
      loadFixture(`hyperliquid/vaultDetails-${body.vaultAddress.toLowerCase()}.json`),
    );
  }
  return Promise.reject(new Error(`unexpected fetch ${url} ${JSON.stringify(body)}`));
}

describe('HyperliquidSource', () => {
  it('discovers parent/child linkage from the parent record, not the child', async () => {
    const source = new HyperliquidSource({ fetchJson: fixtureFetch });
    const entities = await source.listEntities();
    const parent = entities.find((e) => e.name.includes('Hyperliquidity Provider'));
    const child = entities.find((e) => e.externalId === '0x010461c14e146ac35fe42271bdc1134ee31c703a');
    expect(parent?.parentExternalId).toBeUndefined();
    expect(child?.parentExternalId).toBe(parent?.externalId);
  });

  it('writes daily snapshots only when the day bucket has that UTC date', async () => {
    const source = new HyperliquidSource({ fetchJson: fixtureFetch });
    const raw = loadFixture(
      'hyperliquid/vaultDetails-0x010461c14e146ac35fe42271bdc1134ee31c703a.json',
    ) as {
      portfolio: Array<[string, { accountValueHistory: Array<[number, string]> }]>;
    };
    const day = raw.portfolio.find(([period]) => period === 'day');
    const last = day?.[1]?.accountValueHistory.at(-1);
    if (last === undefined) {
      throw new Error('fixture day bucket is empty');
    }
    const asOf = new Date(Date.UTC(
      new Date(last[0]).getUTCFullYear(),
      new Date(last[0]).getUTCMonth(),
      new Date(last[0]).getUTCDate(),
    ));
    const snapshots = await source.snapshot(asOf);
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every((row) => row.valuePerUnit === undefined)).toBe(true);
    expect(snapshots.every((row) => row.sampling === 'daily')).toBe(true);
    expect(snapshots.every((row) => row.navQuality === 'raw')).toBe(true);
    expect(snapshots.every((row) => row.managerStakeRatio !== undefined)).toBe(true);
  });

  it('backfill points are downsampled', async () => {
    const source = new HyperliquidSource({ fetchJson: fixtureFetch });
    const series = await source.backfill('0xdfc24b077bc1425ad1dea75bcb6f8158e10df303');
    expect(series.length).toBeGreaterThan(10);
    expect(series.every((row) => row.sampling === 'downsampled')).toBe(true);
  });
});
