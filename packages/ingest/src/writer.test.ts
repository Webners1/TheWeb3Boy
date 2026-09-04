import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { Decimal } from '@vaultbench/shared';
import {
  benchmarkPrices,
  entities,
  entityMetadataHistory,
  entitySnapshots,
  ingestRuns,
} from '@vaultbench/db';

import { IngestAbortError } from './guards.js';
import { writeBackfillBatch, writeSourceBatch } from './writer.js';
import type { SourceBatch } from './writer.js';

const migrationPath = fileURLToPath(
  new URL('../../db/migrations/0000_neat_magik.sql', import.meta.url),
);

async function createTestDb() {
  const client = new PGlite();
  let sql = readFileSync(migrationPath, 'utf8').replaceAll('--> statement-breakpoint', '');
  sql = sql.replace('USING brin', 'USING btree');
  await client.exec(sql);
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
      snapshots: [
        {
          source: 'hyperliquid',
          externalId: '0xabc',
          asOf,
          accountValue: new Decimal('999'),
          sampling: 'downsampled',
          navQuality: 'raw',
        },
      ],
    });

    const rows = await db.select().from(entitySnapshots);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.sampling).toBe('daily');
    expect(rows[0]?.accountValue).toBe('10.00000000');
    expect(await db.select().from(benchmarkPrices)).toHaveLength(0);
  });
});
