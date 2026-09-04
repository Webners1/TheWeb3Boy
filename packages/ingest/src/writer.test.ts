import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { Decimal } from '@vaultbench/shared';
import {
  benchmarkPrices,
  entities,
  entityMetadataHistory,
  entitySnapshots,
  ingestRuns,
} from '@vaultbench/db';
import { applyMigrations } from '@vaultbench/db/testing';

import type { RawSnapshot } from '@vaultbench/sources';

import { IngestAbortError } from './guards.js';
import { writeBackfillBatch, writeSourceBatch } from './writer.js';
import type { SourceBatch } from './writer.js';

async function createTestDb() {
  const client = new PGlite();
  await applyMigrations(client);
  return drizzle(client);
}

function entity(overrides: Partial<SourceBatch['entities'][number]> = {}): SourceBatch['entities'][number] {
  return {
    source: 'hyperliquid',
    externalId: '0xabc',
    kind: 'vault',
    name: 'Test Vault',
    venue: 'hyperliquid',
    venueType: 'dex',
    marketType: 'perp',
    baseCurrency: 'USDC',
    status: 'active',
    metadata: { leaderCommission: new Decimal('0.1') },
    ...overrides,
  };
}

describe('writeSourceBatch', () => {
  it('aborts an empty universe and writes no entities', async () => {
    const db = await createTestDb();
    await expect(
      writeSourceBatch(db as never, {
        source: 'hyperliquid',
        asOf: new Date('2026-09-04T00:00:00Z'),
        fetchedAt: new Date(),
        entities: [],
        snapshots: [],
        depositors: [],
      }),
    ).rejects.toBeInstanceOf(IngestAbortError);

    const rows = await db.select().from(entities);
    expect(rows).toHaveLength(0);
    const runs = await db.select().from(ingestRuns);
    expect(runs[0]?.status).toBe('aborted');
  });

  it('is idempotent for the same date', async () => {
    const db = await createTestDb();
    const asOf = new Date('2026-09-04T00:00:00Z');
    const batch: SourceBatch = {
      source: 'hyperliquid',
      asOf,
      fetchedAt: new Date('2026-09-04T12:00:00Z'),
      entities: [entity()],
      snapshots: [
        {
          source: 'hyperliquid',
          externalId: '0xabc',
          asOf,
          accountValue: new Decimal('100.5'),
          cumPnl: new Decimal('1.25'),
          aumUsd: new Decimal('100.5'),
          sampling: 'daily',
          navQuality: 'raw',
        },
      ],
      depositors: [],
    };

    await writeSourceBatch(db as never, batch);
    await writeSourceBatch(db as never, batch);

    expect(await db.select().from(entities)).toHaveLength(1);
    expect(await db.select().from(entitySnapshots)).toHaveLength(1);
    const okRuns = (await db.select().from(ingestRuns)).filter((run) => run.status === 'ok');
    expect(okRuns).toHaveLength(2);
  });

  it('closes an SCD row when a fee changes', async () => {
    const db = await createTestDb();
    const day1 = new Date('2026-09-04T00:00:00Z');
    const day2 = new Date('2026-09-05T00:00:00Z');

    await writeSourceBatch(db as never, {
      source: 'hyperliquid',
      asOf: day1,
      fetchedAt: day1,
      entities: [entity()],
      snapshots: [],
      depositors: [],
    });

    await writeSourceBatch(db as never, {
      source: 'hyperliquid',
      asOf: day2,
      fetchedAt: day2,
      entities: [entity({ metadata: { leaderCommission: new Decimal('0.2') } })],
      snapshots: [],
      depositors: [],
    });

    const history = await db.select().from(entityMetadataHistory);
    expect(history).toHaveLength(2);
    const closed = history.find((row) => row.validTo !== null);
    const open = history.find((row) => row.validTo === null);
    expect(closed?.leaderCommission).toBe('0.1000');
    expect(closed?.validTo).toBe('2026-09-04');
    expect(open?.leaderCommission).toBe('0.2000');
    expect(open?.validFrom).toBe('2026-09-05');
  });

  it('marks an entity delisted when it disappears from the universe', async () => {
    const db = await createTestDb();
    const day1 = new Date('2026-09-04T00:00:00Z');
    const day2 = new Date('2026-09-05T00:00:00Z');

    await writeSourceBatch(db as never, {
      source: 'okx',
      asOf: day1,
      fetchedAt: day1,
      entities: [
        entity({ source: 'okx', externalId: 'swap:AAA', venue: 'okx', venueType: 'cex', kind: 'lead_trader' }),
      ],
      snapshots: [],
      depositors: [],
    });

    await writeSourceBatch(db as never, {
      source: 'okx',
      asOf: day2,
      fetchedAt: day2,
      entities: [
        entity({
          source: 'okx',
          externalId: 'swap:BBB',
          venue: 'okx',
          venueType: 'cex',
          kind: 'lead_trader',
          name: 'Other',
        }),
      ],
      snapshots: [],
      depositors: [],
    });

    const rows = await db.select().from(entities).where(eq(entities.externalId, 'swap:AAA'));
    expect(rows[0]?.status).toBe('delisted');
  });
});

describe('writeBackfillBatch', () => {
  it('does not overwrite a daily snapshot with a downsampled one', async () => {
    const db = await createTestDb();
    const asOf = new Date('2026-09-04T00:00:00Z');
    const descriptor = entity();

    await writeSourceBatch(db as never, {
      source: 'hyperliquid',
      asOf,
      fetchedAt: asOf,
      entities: [descriptor],
      snapshots: [
        {
          source: 'hyperliquid',
          externalId: '0xabc',
          asOf,
          accountValue: new Decimal('10'),
          sampling: 'daily',
          navQuality: 'raw',
        },
      ],
      depositors: [],
    });

    await writeBackfillBatch(db as never, {
      source: 'hyperliquid',
      fetchedAt: new Date(),
      entities: [descriptor],
      snapshots: chunks([
        {
          source: 'hyperliquid',
          externalId: '0xabc',
          asOf,
          accountValue: new Decimal('999'),
          sampling: 'downsampled',
          navQuality: 'raw',
        },
      ]),
    });

    const rows = await db.select().from(entitySnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sampling).toBe('daily');
    expect(rows[0]?.accountValue).toBe('10.00000000');
    expect(await db.select().from(benchmarkPrices)).toHaveLength(0);
  });

  it('points raw_ref at the run that archived the payload, not the snapshot date', async () => {
    /**
     * The bug this exists for. A backfill fetched today writes snapshots dated
     * years ago, and the archive lives under *today*. Deriving raw_ref from
     * the snapshot's own as_of produced
     * `raw/chamber/2023-12-21/<external_id>.json.gz` for all 60,558 Chamber
     * rows — a path that had never been written, on a column whose only job is
     * to let a reader find the payload a number came from.
     */
    const db = await createTestDb();
    const fetchedAt = new Date('2026-09-04T00:00:00Z');

    await writeBackfillBatch(db as never, {
      source: 'chamber',
      fetchedAt,
      entities: [entity()],
      snapshots: chunks([
        {
          source: 'chamber',
          externalId: '0xabc',
          asOf: new Date('2023-12-21T00:00:00Z'),
          valuePerUnit: new Decimal('1.5'),
          sampling: 'downsampled',
          navQuality: 'reported',
          rawName: 'tokenPriceHistory/base:0xabc',
        },
      ]),
    });

    const rows = await db.select().from(entitySnapshots);
    expect(rows[0]?.asOf).toBe('2023-12-21');
    // Run date in the path, and the adapter's own archive name.
    expect(rows[0]?.rawRef).toBe(
      'raw/chamber/2026-09-04/tokenPriceHistory/base:0xabc.json.gz',
    );
  });

  it('leaves raw_ref null rather than inventing a path', async () => {
    // A pointer that resolves to nothing is worse than an absent one: null
    // says "no payload recorded", a wrong path says "here it is".
    const db = await createTestDb();

    await writeBackfillBatch(db as never, {
      source: 'chamber',
      fetchedAt: new Date('2026-09-04T00:00:00Z'),
      entities: [entity()],
      snapshots: chunks([
        {
          source: 'chamber',
          externalId: '0xabc',
          asOf: new Date('2023-12-21T00:00:00Z'),
          valuePerUnit: new Decimal('1.5'),
          sampling: 'downsampled',
          navQuality: 'reported',
        },
      ]),
    });

    const rows = await db.select().from(entitySnapshots);
    expect(rows[0]?.rawRef).toBeNull();
  });

  it('consumes history lazily, one entity at a time', async () => {
    /**
     * The memory fix. The writer must pull chunks as it goes rather than
     * receive the universe up front — for Enzyme that array would have been
     * past a million snapshot objects and the job would have died of heap
     * exhaustion after twenty minutes of rate-limited fetching, with nothing
     * written.
     *
     * Asserted by observing that rows are already committed by the time the
     * generator is asked for its second entity.
     */
    const db = await createTestDb();
    const first = entity({ externalId: '0xaaa' });
    const second = entity({ externalId: '0xbbb' });
    const committedBeforeSecond: number[] = [];

    async function* lazy() {
      yield [snapshot('0xaaa', '2024-01-01')];
      committedBeforeSecond.push((await db.select().from(entitySnapshots)).length);
      yield [snapshot('0xbbb', '2024-01-01')];
    }

    const result = await writeBackfillBatch(db as never, {
      source: 'chamber',
      fetchedAt: new Date('2026-09-04T00:00:00Z'),
      entities: [first, second],
      snapshots: lazy(),
    });

    // The first entity's row was durable before the second was fetched.
    expect(committedBeforeSecond).toEqual([1]);
    expect(result.rowsWritten).toBe(2);
    expect(await db.select().from(entitySnapshots)).toHaveLength(2);
  });

  it('keeps the entities it reached when a later fetch fails', async () => {
    // A single universe-wide transaction threw away hours of polite,
    // rate-limited work on one bad response. Per-entity transactions mean a
    // re-run resumes instead of restarting; snapshots are keyed
    // (entity_id, as_of) so re-running is safe.
    const db = await createTestDb();

    async function* failsHalfway() {
      yield [snapshot('0xaaa', '2024-01-01')];
      throw new Error('venue returned 500');
    }

    await expect(
      writeBackfillBatch(db as never, {
        source: 'chamber',
        fetchedAt: new Date('2026-09-04T00:00:00Z'),
        entities: [entity({ externalId: '0xaaa' }), entity({ externalId: '0xbbb' })],
        snapshots: failsHalfway(),
      }),
    ).rejects.toThrow(/venue returned 500/);

    expect(await db.select().from(entitySnapshots)).toHaveLength(1);
    const runs = await db.select().from(ingestRuns);
    expect(runs.at(-1)?.status).toBe('failed');
  });

  it('writes more rows than fit in one insert statement', async () => {
    // Inserts are chunked at 500 to stay under Postgres's bound-parameter
    // cap; the boundary is where an off-by-one would hide.
    const db = await createTestDb();
    const history = Array.from({ length: 1201 }, (_, index) =>
      snapshot('0xabc', isoDay(index)),
    );

    const result = await writeBackfillBatch(db as never, {
      source: 'chamber',
      fetchedAt: new Date('2026-09-04T00:00:00Z'),
      entities: [entity()],
      snapshots: chunks(history),
    });

    expect(result.rowsWritten).toBe(1201);
    expect(await db.select().from(entitySnapshots)).toHaveLength(1201);
  });
});

/** Wraps a finished array as the single chunk the writer expects. */
async function* chunks(snapshots: RawSnapshot[]): AsyncGenerator<RawSnapshot[]> {
  yield snapshots;
}

function snapshot(externalId: string, asOf: string): RawSnapshot {
  return {
    source: 'chamber',
    externalId,
    asOf: new Date(`${asOf}T00:00:00Z`),
    valuePerUnit: new Decimal('1.25'),
    sampling: 'downsampled',
    navQuality: 'reported',
  };
}

function isoDay(offset: number): string {
  const base = Date.UTC(2020, 0, 1) + offset * 86_400_000;
  return new Date(base).toISOString().slice(0, 10);
}
