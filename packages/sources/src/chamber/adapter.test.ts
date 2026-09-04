import { describe, expect, it } from 'vitest';

import { ChamberSource, externalId, parseExternalId } from './adapter.js';
import { chamberFundSchema } from './schemas.js';
import { loadFixture } from '../load-fixture.js';

/**
 * Fixtures were captured from the live public API by
 * `tools/capture-chamber-fixtures.mjs`, so these assertions run against real
 * payload shapes rather than shapes we imagined.
 */
function fixtureFetch(_url: string, options?: { body?: unknown }): Promise<unknown> {
  const query = (options?.body as { query?: string } | undefined)?.query ?? '';

  if (query.includes('allFundsByBlockchainCode')) {
    if (query.includes('"POLYGON"')) {
      return Promise.resolve(loadFixture('chamber/all-funds-polygon.json'));
    }
    return Promise.resolve(loadFixture('chamber/all-funds-empty.json'));
  }
  if (query.includes('tokenPriceHistory')) {
    return Promise.resolve(loadFixture('chamber/token-price-history.json'));
  }
  return Promise.reject(new Error(`unexpected query: ${query}`));
}

function polygonSource(): ChamberSource {
  return new ChamberSource({ chains: ['POLYGON'], fetchJson: fixtureFetch });
}

describe('ChamberSource entities', () => {
  it('keys entities by chain and address, because an address can be on two chains', async () => {
    const entities = await polygonSource().listEntities();
    expect(entities.length).toBeGreaterThan(0);
    expect(entities.every((entity) => entity.externalId.startsWith('polygon:0x'))).toBe(true);
  });

  it('keeps dead vaults in the universe — that is the whole point of an on-chain source', async () => {
    const entities = await polygonSource().listEntities();
    const closed = entities.filter((entity) => entity.status === 'closed');
    expect(closed.length).toBeGreaterThan(0);
  });

  it('converts basis-point fee numerators into fractions', async () => {
    const entities = await polygonSource().listEntities();
    const withFees = entities.find((entity) => entity.metadata.feeProfitShare !== undefined);
    // 2000 basis points is a 20% performance fee, not 2000%.
    expect(withFees?.metadata.feeProfitShare?.toFixed()).toBe('0.2');
  });

  it('reads inception from blockTime, which is seconds not milliseconds', async () => {
    const entities = await polygonSource().listEntities();
    const dated = entities.find((entity) => entity.inceptionDate !== undefined);
    const year = dated?.inceptionDate?.getUTCFullYear() ?? 0;
    // Treating seconds as milliseconds would land this in 1970.
    expect(year).toBeGreaterThan(2018);
    expect(year).toBeLessThan(2030);
  });

  it('discards rows whose chain does not match the chain we asked for', async () => {
    // An unrecognised code can silently fall back to another chain's data.
    // Trusting the response would duplicate a whole universe under a wrong key.
    const source = new ChamberSource({ chains: ['NOPECHAIN'], fetchJson: fixtureFetch });
    expect(await source.listEntities()).toEqual([]);
  });
});

describe('ChamberSource snapshots', () => {
  it('publishes a true per-share NAV, de-scaled from wei', async () => {
    const snapshots = await polygonSource().snapshot(new Date('2026-02-01T00:00:00Z'));
    expect(snapshots.length).toBeGreaterThan(0);

    const first = snapshots[0];
    // tokenPrice "2472490027567141677" is 2.4724... , not 2.47e18.
    expect(first?.valuePerUnit?.toFixed()).toBe('2.472490027567141677');
    expect(first?.aumUsd?.toFixed()).toBe('1832887.212382350538715232');
  });

  it('tags the series reported, not derived — the venue published it', async () => {
    const snapshots = await polygonSource().snapshot(new Date('2026-02-01T00:00:00Z'));
    expect(snapshots.every((row) => row.navQuality === 'reported')).toBe(true);
    expect(snapshots.every((row) => row.sampling === 'daily')).toBe(true);
  });
});

describe('ChamberSource backfill', () => {
  it('reads adjustedTokenPrice, because tokenPrice is null on every history point', async () => {
    const series = await polygonSource().backfill('polygon:0x6aabe7861ffbcfbe8c6d925971de2c69a381136d');
    const raw = loadFixture('chamber/token-price-history.json') as {
      data: { tokenPriceHistory: { history: Array<{ tokenPrice: string | null }> } };
    };
    expect(raw.data.tokenPriceHistory.history.every((point) => point.tokenPrice === null)).toBe(true);
    expect(series.length).toBeGreaterThan(0);
    expect(series.every((row) => row.valuePerUnit !== undefined)).toBe(true);
  });

  it('treats the history value as cumulative return, so inception indexes at 1', async () => {
    const series = await polygonSource().backfill('polygon:0x6aabe7861ffbcfbe8c6d925971de2c69a381136d');
    const raw = loadFixture('chamber/token-price-history.json') as {
      data: { tokenPriceHistory: { history: Array<{ adjustedTokenPrice: string | null }> } };
    };

    // The real `all` response opens at exactly "0" — a vault at inception has
    // earned nothing, and its per-unit index is 1.
    expect(raw.data.tokenPriceHistory.history[0]?.adjustedTokenPrice).toBe('0');
    expect(series[0]?.valuePerUnit?.toFixed()).toBe('1');
    expect(series).toHaveLength(raw.data.tokenPriceHistory.history.length);
  });

  it('maps an underwater vault below 1 without ever going negative', async () => {
    const series = await polygonSource().backfill('polygon:0x6aabe7861ffbcfbe8c6d925971de2c69a381136d');
    // Fixture point 2 is "-0.006962540527678172". Read as a price that is
    // impossible; read as a return it is a vault down 0.7%.
    expect(series[2]?.valuePerUnit?.toFixed()).toBe('0.993037459472321828');
    expect(series.every((row) => row.valuePerUnit?.gt(0))).toBe(true);
  });

  it('marks history downsampled — `all` returns two-day spacing, not daily', async () => {
    const series = await polygonSource().backfill('polygon:0x6aabe7861ffbcfbe8c6d925971de2c69a381136d');
    expect(series.every((row) => row.sampling === 'downsampled')).toBe(true);
  });

  it('returns nothing when the vault has no history rather than throwing', async () => {
    const source = new ChamberSource({
      chains: ['POLYGON'],
      fetchJson: () => Promise.resolve(loadFixture('chamber/token-price-history-null.json')),
    });
    expect(await source.backfill('polygon:0xabc')).toEqual([]);
  });

  it('refuses an external id that is missing its chain prefix', async () => {
    await expect(polygonSource().backfill('0xabc')).rejects.toThrow(/chain:address/);
  });
});

describe('chamber schema guards', () => {
  it('rejects a fee numerator above the 10,000 basis-point denominator', () => {
    const base = (
      loadFixture('chamber/all-funds-polygon.json') as {
        data: { allFundsByBlockchainCode: unknown[] };
      }
    ).data.allFundsByBlockchainCode[0] as Record<string, unknown>;

    // If dHEDGE ever changed the denominator, a silent 200% fee would be far
    // worse than a loud parse failure.
    const result = chamberFundSchema.safeParse({ ...base, performanceFeeNumerator: '20000' });
    expect(result.success).toBe(false);
  });

  it('round-trips an external id', () => {
    const fund = { blockchainCode: 'BASE', address: '0xabc' } as Parameters<typeof externalId>[0];
    expect(parseExternalId(externalId(fund))).toEqual({ chain: 'base', address: '0xabc' });
  });
});
