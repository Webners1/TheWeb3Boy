import { describe, expect, it } from 'vitest';

import { parseOrThrow } from './parse.js';
import { loadFixture } from './load-fixture.js';
import {
  vaultDetailsSchema,
  vaultStatsRegistrySchema,
  vaultSummariesSchema,
} from './hyperliquid/schemas.js';
import { llamaChartSchema, llamaHistoricalSchema } from './defillama/schemas.js';
import {
  okxCopyTradersSchema,
  okxDailyPnlSchema,
  okxLeadTradersPageSchema,
  okxStatsSchema,
  okxSubpositionHistorySchema,
} from './okx/schemas.js';

describe('hyperliquid fixtures', () => {
  it('parses the captured stats registry sample', () => {
    const raw = loadFixture('hyperliquid/vaults.json');
    const parsed = parseOrThrow(vaultStatsRegistrySchema, raw, 'vaults');
    expect(parsed.length).toBeGreaterThan(0);
    const parent = parsed.find((row) => row.summary.relationship.type === 'parent');
    expect(parent?.summary.relationship.data?.childAddresses?.length).toBeGreaterThan(0);
  });

  it('parses captured vaultDetails including Leader as a depositor id', () => {
    const raw = loadFixture(
      'hyperliquid/vaultDetails-0x010461c14e146ac35fe42271bdc1134ee31c703a.json',
    );
    const parsed = parseOrThrow(vaultDetailsSchema, raw, 'details');
    expect(parsed.followers[0]?.user).toBe('Leader');
    expect(parsed.portfolio.some(([period]) => period === 'allTime')).toBe(true);
  });

  it('parses empty vaultSummaries (the new-vault feed)', () => {
    const parsed = parseOrThrow(
      vaultSummariesSchema,
      loadFixture('hyperliquid/vaultSummaries.empty.json'),
      'summaries',
    );
    expect(parsed).toEqual([]);
  });

  it('aborts on a corrupt stats row', () => {
    expect(() =>
      parseOrThrow(
        vaultStatsRegistrySchema,
        [loadFixture('hyperliquid/vaults.corrupt.json')],
        'corrupt',
      ),
    ).toThrow(/schema validation failed/);
  });
});

describe('defillama fixtures', () => {
  it('parses historical JSON numbers into canonical decimal strings', () => {
    const parsed = parseOrThrow(
      llamaHistoricalSchema,
      loadFixture('defillama/historical.json'),
      'historical',
    );
    expect(parsed.coins['coingecko:bitcoin']?.price).toBe('42261');
    expect(parsed.coins['coingecko:ethereum']?.price).toBe('2281.59');
  });

  it('parses a chart series', () => {
    const parsed = parseOrThrow(llamaChartSchema, loadFixture('defillama/chart-btc.json'), 'chart');
    expect(parsed.coins['coingecko:bitcoin']?.prices.length).toBeGreaterThan(0);
  });
});

describe('okx fixtures', () => {
  it('parses swap and spot lead-trader ranks as distinct payloads', () => {
    const swap = parseOrThrow(
      okxLeadTradersPageSchema,
      loadFixture('okx/lead-traders-swap.json'),
      'swap',
    );
    const spot = parseOrThrow(
      okxLeadTradersPageSchema,
      loadFixture('okx/lead-traders-spot.json'),
      'spot',
    );
    expect(swap.data[0]?.ranks[0]?.uniqueCode).toBeTruthy();
    expect(spot.data[0]?.ranks[0]?.uniqueCode).toBeTruthy();
    expect(swap.data[0]?.ranks[0]?.uniqueCode).not.toBe(spot.data[0]?.ranks[0]?.uniqueCode);
  });

  it('parses public-pnl, stats, copy-traders and subposition history', () => {
    parseOrThrow(okxDailyPnlSchema, loadFixture('okx/public-pnl.json'), 'pnl');
    parseOrThrow(okxStatsSchema, loadFixture('okx/public-stats.json'), 'stats');
    parseOrThrow(okxCopyTradersSchema, loadFixture('okx/copy-traders.json'), 'copies');
    parseOrThrow(
      okxSubpositionHistorySchema,
      loadFixture('okx/subpositions-history.json'),
      'history',
    );
  });
});
