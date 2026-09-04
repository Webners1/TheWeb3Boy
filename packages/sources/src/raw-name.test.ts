import { describe, expect, it } from 'vitest';

import { ChamberSource } from './chamber/adapter.js';
import { EnzymeSource } from './enzyme/adapter.js';
import { HyperliquidSource } from './hyperliquid/adapter.js';
import { OkxSource } from './okx/adapter.js';
import { loadFixture } from './load-fixture.js';
import type { RawSnapshot } from './types.js';

/**
 * Every snapshot must name a payload the adapter actually archived.
 *
 * `entity_snapshots.raw_ref` exists so a reader can find the payload a number
 * came from. It used to be assembled by the writer, which guessed the name per
 * source — `vaultDetails/<id>` for Hyperliquid, the bare external id for
 * everyone else — and guessed wrong for every backfilled row: 60,558 Chamber
 * snapshots pointed at `raw/chamber/<snapshot-date>/<external-id>.json.gz`,
 * a path that had never been written. It was also wrong for OKX, whose real
 * archive key carries the page number the rank was found on.
 *
 * The adapter now reports the name, because only the adapter knows it. That
 * moves the risk from "the writer's guess is wrong" to "the adapter's report
 * drifts from what it archived", which is what these tests pin down: capture
 * the names passed to `onRaw`, then assert every snapshot's `rawName` is one
 * of them.
 *
 * A dangling pointer is worse than no pointer, so a missing `rawName` is
 * allowed and becomes a null `raw_ref`; a *wrong* one is not.
 */
function recorder() {
  const archived = new Set<string>();
  return {
    archived,
    onRaw: async (name: string): Promise<void> => {
      archived.add(name);
    },
  };
}

function expectNamesArchived(snapshots: readonly RawSnapshot[], archived: Set<string>): void {
  expect(snapshots.length).toBeGreaterThan(0);
  for (const snapshot of snapshots) {
    if (snapshot.rawName === undefined) continue;
    expect(archived, `${snapshot.source} ${snapshot.externalId}`).toContain(snapshot.rawName);
  }
}

function chamberFetch(_url: string, options?: { body?: unknown }): Promise<unknown> {
  const query = (options?.body as { query?: string } | undefined)?.query ?? '';
  if (query.includes('allFundsByBlockchainCode')) {
    return Promise.resolve(loadFixture('chamber/all-funds-polygon.json'));
  }
  if (query.includes('tokenPriceHistory')) {
    return Promise.resolve(loadFixture('chamber/token-price-history.json'));
  }
  return Promise.reject(new Error(`unexpected query: ${query}`));
}

describe('raw_ref names resolve to archived payloads', () => {
  it('holds for Chamber snapshots', async () => {
    const sink = recorder();
    const source = new ChamberSource({
      chains: ['POLYGON'],
      fetchJson: chamberFetch,
      onRaw: sink.onRaw,
    });

    const snapshots = await source.snapshot(new Date('2026-02-01T00:00:00Z'));
    expectNamesArchived(snapshots, sink.archived);
    // Not merely present — the chain has to be the fund's own, since one
    // adapter run spans several chains.
    expect(snapshots[0]?.rawName).toBe('allFunds/polygon');
  });

  it('holds for Chamber history', async () => {
    const sink = recorder();
    const source = new ChamberSource({
      chains: ['POLYGON'],
      fetchJson: chamberFetch,
      onRaw: sink.onRaw,
    });

    const snapshots = await source.backfill('polygon:0xabc');
    expectNamesArchived(snapshots, sink.archived);
    expect(snapshots[0]?.rawName).toBe('tokenPriceHistory/polygon:0xabc');
  });

  it('holds for Enzyme snapshots', async () => {
    const sink = recorder();
    const source = new EnzymeSource({
      apiKey: 'k',
      deployments: ['ETHEREUM'],
      fetchJson: () =>
        Promise.resolve({
          numberOfVaults: 1,
          vaults: [
            {
              address: '0x27f23c710dd3d878fe9393d60250d6e6ab8a3e1e',
              sharePrice: 1.05,
              sharePriceValid: true,
            },
          ],
        }),
      onRaw: sink.onRaw,
    });

    const snapshots = await source.snapshot(new Date('2026-02-01T00:00:00Z'));
    expectNamesArchived(snapshots, sink.archived);
    expect(snapshots[0]?.rawName).toBe('vaultList/ethereum');
  });

  it('holds for OKX snapshots, whose key carries the page number', async () => {
    /**
     * The worst of the writer's old guesses. OKX ranks are paginated and the
     * page number is part of the archive key, so `lead-traders/<external_id>`
     * was never a path that existed for any row. The page has to be captured
     * where the request is made — by the time the pages are flattened it is
     * gone.
     */
    const sink = recorder();
    const source = new OkxSource({
      fetchJson: (url: string) =>
        Promise.resolve(
          loadFixture(
            url.includes('instType=SPOT')
              ? 'okx/lead-traders-spot.json'
              : 'okx/lead-traders-swap.json',
          ),
        ),
      onRaw: sink.onRaw,
    });

    const snapshots = await source.snapshot(new Date('2026-02-01T00:00:00Z'));
    expectNamesArchived(snapshots, sink.archived);
    expect(snapshots[0]?.rawName).toMatch(/^lead-traders\/(SPOT|SWAP)\/page-\d+$/);
  });

  it('holds for Hyperliquid history', async () => {
    const sink = recorder();
    const address = '0xdfc24b077bc1425ad1dea75bcb6f8158e10df303';
    const source = new HyperliquidSource({
      fetchJson: () => Promise.resolve(loadFixture(`hyperliquid/vaultDetails-${address}.json`)),
      onRaw: sink.onRaw,
    });

    const snapshots = await source.backfill(address);
    expectNamesArchived(snapshots, sink.archived);
    expect(snapshots[0]?.rawName).toBe(`vaultDetails/${address}`);
  });
});
