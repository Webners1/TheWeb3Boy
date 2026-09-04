import { PGlite } from '@electric-sql/pglite';
import { asc, eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/pglite';
import { describe, expect, it } from 'vitest';
import {
  benchmarkPrices,
  depositors,
  entities,
  entityFlows,
  entityMetadataHistory,
  entityMetrics,
  entityNav,
  entitySnapshots,
  metricDefinitions,
  type Db,
} from '@vaultbench/db';
import { applyMigrations } from '@vaultbench/db/testing';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { METRIC_DEFINITIONS, INCEPTION_WINDOW } from '@vaultbench/core';

import { recompute } from './recompute.js';

async function createTestDb(): Promise<Db> {
  const client = new PGlite();
  await applyMigrations(client);
  return drizzle(client) as unknown as Db;
}

const now = new Date('2026-02-01T00:00:00Z');

/**
 * A vault that earns 10%, takes a deposit nine times its own size, then earns
 * 10% again — the same shape as the unit tests, but end to end through
 * Postgres so the numeric round-trip is exercised too.
 */
async function seed(db: Db, source = 'hyperliquid'): Promise<string> {
  const [entity] = await db
    .insert(entities)
    .values({
      source,
      externalId: '0xabc',
      kind: 'vault',
      name: 'Test Vault',
      venue: source,
      venueType: 'dex',
      marketType: 'perp',
      baseCurrency: 'USDC',
      status: 'active',
      firstSeenAt: now,
      lastSeenAt: now,
    })
    .returning({ id: entities.id });

  if (!entity) throw new Error('seed failed');

  const rows = [
    { asOf: '2026-01-01', accountValue: '1000.00000000', cumPnl: '0.00000000' },
    { asOf: '2026-01-02', accountValue: '1100.00000000', cumPnl: '100.00000000' },
    { asOf: '2026-01-03', accountValue: '11100.00000000', cumPnl: '100.00000000' },
    { asOf: '2026-01-04', accountValue: '12210.00000000', cumPnl: '1210.00000000' },
  ];

  await db.insert(entitySnapshots).values(
    rows.map((row) => ({
      entityId: entity.id,
      asOf: row.asOf,
      accountValue: row.accountValue,
      cumPnl: row.cumPnl,
      sampling: 'daily',
      navQuality: 'raw',
      fetchedAt: now,
    })),
  );

  await db.insert(benchmarkPrices).values([
    { symbol: 'BTC', asOf: '2026-01-01', closeUsd: '100000.00000000', source: 'defillama' },
    { symbol: 'BTC', asOf: '2026-01-04', closeUsd: '110000.00000000', source: 'defillama' },
  ]);

  return entity.id;
}

describe('recompute', () => {
  it('derives a flow-neutral NAV series from raw snapshots', async () => {
    const db = await createTestDb();
    const entityId = await seed(db);

    const result = await recompute({ db });
    expect(result.entitiesProcessed).toBe(1);

    const nav = await db
      .select()
      .from(entityNav)
      .where(eq(entityNav.entityId, entityId))
      .orderBy(asc(entityNav.asOf));

    expect(nav.map((row) => row.valuePerUnit)).toEqual([
      '1.000000000000000000',
      '1.100000000000000000',
      '1.100000000000000000',
      '1.210000000000000000',
    ]);
    expect(nav.map((row) => row.method)).toEqual(['simple', 'simple', 'dietz', 'simple']);
    expect(nav.every((row) => row.navQuality === 'derived')).toBe(true);
  });

  it('records the reconstructed deposit as a flow, not as return', async () => {
    const db = await createTestDb();
    const entityId = await seed(db);
    await recompute({ db });

    const flows = await db
      .select()
      .from(entityFlows)
      .where(eq(entityFlows.entityId, entityId))
      .orderBy(asc(entityFlows.asOf));

    expect(flows.map((row) => [row.asOf, row.netFlowUsd])).toEqual([
      ['2026-01-02', '0.00000000'],
      ['2026-01-03', '10000.00000000'],
      ['2026-01-04', '0.00000000'],
    ]);
  });

  it('writes one metrics row per window with coverage attached', async () => {
    const db = await createTestDb();
    const entityId = await seed(db);
    await recompute({ db, windows: [7, INCEPTION_WINDOW] });

    const rows = await db
      .select()
      .from(entityMetrics)
      .where(eq(entityMetrics.entityId, entityId))
      .orderBy(asc(entityMetrics.windowDays));

    expect(rows).toHaveLength(2);

    const inception = rows.find((row) => row.windowDays === INCEPTION_WINDOW);
    // 10% then 10%, with the 10x deposit in between contributing nothing.
    expect(inception?.twr).toBe('0.2100000000');
    expect(inception?.daysCovered).toBe(4);
    expect(inception?.sampling).toBe('daily');
    expect(inception?.headlineEligible).toBe(true);

    const week = rows.find((row) => row.windowDays === 7);
    expect(week?.isFullWindow).toBe(false);
    expect(week?.daysCovered).toBe(4);
  });

  it('benchmarks against the same start and end dates, net of an entry swap', async () => {
    const db = await createTestDb();
    const entityId = await seed(db);
    await recompute({ db, windows: [INCEPTION_WINDOW] });

    const [row] = await db
      .select()
      .from(entityMetrics)
      .where(eq(entityMetrics.entityId, entityId));

    // 110000/100000 * 0.999 - 1
    expect(row?.benchTwrBtc).toBe('0.0989000000');
    expect(row?.alphaBtc).toBe('0.1111000000');
    // No ETH or SOL prices loaded: absent, not zero.
    expect(row?.benchTwrEth).toBeNull();
    expect(row?.alphaEth).toBeNull();
  });

  it('is idempotent — a second pass produces identical rows', async () => {
    const db = await createTestDb();
    const entityId = await seed(db);

    await recompute({ db, windows: [INCEPTION_WINDOW] });
    const first = await db.select().from(entityNav).where(eq(entityNav.entityId, entityId));
    await recompute({ db, windows: [INCEPTION_WINDOW] });
    const second = await db.select().from(entityNav).where(eq(entityNav.entityId, entityId));

    expect(second).toHaveLength(first.length);
    expect(second.map((row) => row.valuePerUnit)).toEqual(first.map((row) => row.valuePerUnit));
  });

  it('applies the recorded profit share when the venue reports gross', async () => {
    const db = await createTestDb();
    const entityId = await seed(db);

    await db.insert(entityMetadataHistory).values({
      entityId,
      validFrom: '2026-01-01',
      validTo: null,
      leaderCommission: '0.2000',
      status: 'active',
    });

    await recompute({ db, windows: [INCEPTION_WINDOW] });
    const [row] = await db
      .select()
      .from(entityMetrics)
      .where(eq(entityMetrics.entityId, entityId));

    // 21% gross less a 20% cut of the gain.
    expect(row?.twr).toBe('0.1680000000');
  });

  it('keeps a venue-published share price headline eligible', async () => {
    // Chamber publishes a real per-share NAV. It is already time-weighted,
    // so it is a better input than our own reconstruction, not a worse one.
    const db = await createTestDb();
    const [entity] = await db
      .insert(entities)
      .values({
        source: 'chamber',
        externalId: 'polygon:0xabc',
        kind: 'vault',
        name: 'Chamber Vault',
        venue: 'chamber:polygon',
        venueType: 'dex',
        marketType: 'mixed',
        baseCurrency: 'USD',
        status: 'active',
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: entities.id });
    if (!entity) throw new Error('seed failed');

    await db.insert(entitySnapshots).values(
      [
        ['2026-01-01', '1.000000000000000000'],
        ['2026-01-04', '1.250000000000000000'],
      ].map(([asOf, valuePerUnit]) => ({
        entityId: entity.id,
        asOf: asOf as string,
        valuePerUnit: valuePerUnit as string,
        sampling: 'daily',
        navQuality: 'reported',
        fetchedAt: now,
      })),
    );

    await recompute({ db, source: 'chamber', windows: [INCEPTION_WINDOW] });
    const [row] = await db
      .select()
      .from(entityMetrics)
      .where(eq(entityMetrics.entityId, entity.id));

    expect(row?.navQuality).toBe('reported');
    expect(row?.headlineEligible).toBe(true);
    expect(row?.twr).toBe('0.2500000000');
  });

  it('holds an unverified venue out of headline rankings without dropping it', async () => {
    const db = await createTestDb();

    const [entity] = await db
      .insert(entities)
      .values({
        source: 'okx',
        externalId: 'lead-1',
        kind: 'lead_trader',
        name: 'Lead',
        venue: 'okx',
        venueType: 'cex',
        marketType: 'perp',
        baseCurrency: 'USDT',
        status: 'active',
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: entities.id });
    if (!entity) throw new Error('seed failed');

    await db.insert(entitySnapshots).values([
      {
        entityId: entity.id,
        asOf: '2026-01-01',
        valuePerUnit: '1.000000000000000000',
        sampling: 'daily',
        navQuality: 'reported',
        fetchedAt: now,
      },
      {
        entityId: entity.id,
        asOf: '2026-01-04',
        valuePerUnit: '1.500000000000000000',
        sampling: 'daily',
        navQuality: 'reported',
        fetchedAt: now,
      },
    ]);

    await recompute({ db, source: 'okx', windows: [INCEPTION_WINDOW] });
    const [row] = await db.select().from(entityMetrics).where(eq(entityMetrics.entityId, entity.id));

    // The metrics still exist and are still queryable — OKX is simply not
    // ranked until its PnL field semantics are verified.
    expect(row?.twr).toBe('0.5000000000');
    expect(row?.headlineEligible).toBe(false);
  });

  it('holds a scraped entity out of headline rankings even when the venue is verified', async () => {
    const db = await createTestDb();
    const [entity] = await db
      .insert(entities)
      .values({
        source: 'hyperliquid',
        externalId: '0xscraped',
        kind: 'vault',
        name: 'Scraped Vault',
        venue: 'hyperliquid',
        venueType: 'dex',
        marketType: 'perp',
        baseCurrency: 'USDC',
        status: 'active',
        provenance: 'scraped',
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: entities.id });
    if (!entity) throw new Error('seed failed');

    await db.insert(entitySnapshots).values([
      {
        entityId: entity.id,
        asOf: '2026-01-01',
        valuePerUnit: '1.000000000000000000',
        sampling: 'daily',
        navQuality: 'reported',
        fetchedAt: now,
      },
      {
        entityId: entity.id,
        asOf: '2026-01-04',
        valuePerUnit: '1.500000000000000000',
        sampling: 'daily',
        navQuality: 'reported',
        fetchedAt: now,
      },
    ]);

    await recompute({ db, source: 'hyperliquid', windows: [INCEPTION_WINDOW] });
    const [row] = await db.select().from(entityMetrics).where(eq(entityMetrics.entityId, entity.id));
    expect(row?.twr).toBe('0.5000000000');
    expect(row?.headlineEligible).toBe(false);
  });

  it('holds a wallet out of headline rankings even when the number is reported', async () => {
    const db = await createTestDb();
    const [entity] = await db
      .insert(entities)
      .values({
        source: 'hyperliquid',
        externalId: 'wallet-1',
        kind: 'wallet',
        name: 'A wallet',
        venue: 'solana',
        venueType: 'dex',
        marketType: 'spot',
        baseCurrency: 'USDC',
        status: 'active',
        provenance: 'api',
        firstSeenAt: now,
        lastSeenAt: now,
      })
      .returning({ id: entities.id });
    if (!entity) throw new Error('seed failed');

    await db.insert(entitySnapshots).values([
      {
        entityId: entity.id,
        asOf: '2026-01-01',
        valuePerUnit: '1.000000000000000000',
        sampling: 'daily',
        navQuality: 'reported',
        fetchedAt: now,
      },
      {
        entityId: entity.id,
        asOf: '2026-01-04',
        valuePerUnit: '2.000000000000000000',
        sampling: 'daily',
        navQuality: 'reported',
        fetchedAt: now,
      },
    ]);

    await recompute({ db, source: 'hyperliquid', windows: [INCEPTION_WINDOW] });
    const [row] = await db.select().from(entityMetrics).where(eq(entityMetrics.entityId, entity.id));
    expect(row?.twr).toBe('1.0000000000');
    expect(row?.headlineEligible).toBe(false);
  });

  it('computes the lead-versus-follower gap from the depositor cross-section', async () => {
    const db = await createTestDb();
    const entityId = await seed(db);

    await db.insert(depositors).values([
      {
        entityId,
        asOf: '2026-01-04',
        depositor: '0x1',
        equity: '150.00000000',
        allTimePnl: '50.00000000',
      },
      {
        entityId,
        asOf: '2026-01-04',
        depositor: '0x2',
        equity: '100.00000000',
        allTimePnl: '0.00000000',
      },
      // Fully withdrawn: no computable basis, so excluded rather than clamped.
      {
        entityId,
        asOf: '2026-01-04',
        depositor: '0x3',
        equity: '0.00000000',
        allTimePnl: '10.00000000',
      },
    ]);

    await recompute({ db, windows: [INCEPTION_WINDOW] });
    const [row] = await db
      .select()
      .from(entityMetrics)
      .where(eq(entityMetrics.entityId, entityId));

    expect(row?.followerMedianReturn).toBe('0.2500000000');
    // 0.21 headline minus the 0.25 the median depositor actually realised:
    // this vault's investors did better than its advertised number.
    expect(row?.followerGap).toBe('-0.0400000000');
  });

  it('skips an entity that has no snapshots rather than writing empty metrics', async () => {
    const db = await createTestDb();
    await seed(db);
    await db.insert(entities).values({
      source: 'hyperliquid',
      externalId: '0xdef',
      kind: 'vault',
      name: 'No History',
      venue: 'hyperliquid',
      venueType: 'dex',
      marketType: 'perp',
      baseCurrency: 'USDC',
      status: 'active',
      firstSeenAt: now,
      lastSeenAt: now,
    });

    const result = await recompute({ db, windows: [INCEPTION_WINDOW] });
    expect(result.entitiesProcessed).toBe(1);
    expect(result.entitiesSkipped).toBe(1);
  });

  it('aborts instead of committing a run that produced nothing', async () => {
    const db = await createTestDb();
    await expect(recompute({ db })).rejects.toThrow(/aborting/);
  });
});

describe('metric semantics live in the database', () => {
  it('seeds a definition for every metric definition in core', async () => {
    const db = await createTestDb();
    await seed(db);
    await recompute({ db, windows: [INCEPTION_WINDOW] });

    const rows = await db.select().from(metricDefinitions);
    expect(rows.map((row) => row.key).sort()).toEqual(
      METRIC_DEFINITIONS.map((definition) => definition.key).sort(),
    );
    expect(rows.every((row) => (row.description ?? '').length > 40)).toBe(true);
  });

  it('defines every published entity_metrics column', () => {
    // A number in the table with no row here is a number an agent cannot
    // interpret, which is the failure this table exists to prevent.
    const structural = new Set([
      'entity_id',
      'as_of',
      'window_days',
      'computed_at',
      'headline_eligible',
    ]);
    const defined = new Set(METRIC_DEFINITIONS.map((definition) => definition.key));
    const columns = getTableConfig(entityMetrics as unknown as PgTable).columns.map(
      (column) => column.name,
    );

    const undefinedColumns = columns.filter(
      (name) => !structural.has(name) && !defined.has(name),
    );
    expect(undefinedColumns).toEqual([]);
  });
});
