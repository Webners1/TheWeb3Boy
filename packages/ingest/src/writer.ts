import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  benchmarkPrices,
  depositors,
  entities,
  entityMetadataHistory,
  entitySnapshots,
  ingestRuns,
  type Db,
} from '@vaultbench/db';
import { addUtcDays, logger, toIsoDate, toNumericString, type Decimal } from '@vaultbench/shared';
import type { DepositorRecord, EntityDescriptor, RawSnapshot } from '@vaultbench/sources';

import {
  IngestAbortError,
  evaluateRowBand,
  metadataChanged,
  shouldApplySnapshot,
  type TrackedMetadata,
} from './guards.js';
import { rawRef } from './archive.js';
import { strategyCategoryFor } from './strategy-tags.js';

export interface SourceBatch {
  source: string;
  asOf: Date;
  fetchedAt: Date;
  entities: EntityDescriptor[];
  snapshots: RawSnapshot[];
  depositors: DepositorRecord[];
}

export async function writeSourceBatch(db: Db, batch: SourceBatch): Promise<{ runId: string; rowsWritten: number }> {
  const asOf = toIsoDate(batch.asOf);
  const yesterday = toIsoDate(addUtcDays(batch.asOf, -1));
  const source = batch.source;

  const [run] = await db
    .insert(ingestRuns)
    .values({
      source,
      startedAt: batch.fetchedAt,
      status: 'running',
    })
    .returning({ id: ingestRuns.id });

  if (!run) {
    throw new Error('failed to insert ingest_runs row');
  }

  const previous = await db
    .select({ rowsWritten: ingestRuns.rowsWritten })
    .from(ingestRuns)
    .where(and(eq(ingestRuns.source, source), eq(ingestRuns.status, 'ok')))
    .orderBy(desc(ingestRuns.finishedAt))
    .limit(1);

  const rowsExpected = previous[0]?.rowsWritten ?? null;
  const rowsWritten = batch.entities.length;
  const band = evaluateRowBand(rowsWritten, rowsExpected);

  if (band === 'aborted') {
    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'aborted',
        rowsWritten,
        rowsExpected,
        error: `row-band abort: written=${rowsWritten} expected=${rowsExpected ?? 'none'}`,
      })
      .where(eq(ingestRuns.id, run.id));
    throw new IngestAbortError(
      `${source}: aborting — rows_written=${rowsWritten} rows_expected=${rowsExpected ?? 'none'}`,
    );
  }

  try {
    await db.transaction(async (tx) => {
      const idByExternal = await upsertEntities(tx, batch);
      await applyDelistings(tx, source, batch.fetchedAt, idByExternal);
      await applyParents(tx, batch.entities, idByExternal);
      await upsertSnapshots(
        tx,
        // A daily run archives under the same day it observes, so the two
        // dates coincide here. They do not for a backfill.
        { source, fetchedAt: batch.fetchedAt, archivedAt: batch.asOf },
        batch.snapshots,
        idByExternal,
      );
      await replaceDepositors(tx, batch, idByExternal, asOf);
      await applyMetadata(tx, batch, idByExternal, asOf, yesterday);
    });

    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'ok',
        rowsWritten,
        rowsExpected,
        error: null,
      })
      .where(eq(ingestRuns.id, run.id));

    logger.info('ingest ok', { source, asOf, rowsWritten, snapshots: batch.snapshots.length });
    return { runId: run.id, rowsWritten };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'failed',
        rowsWritten: 0,
        rowsExpected,
        error: message,
      })
      .where(eq(ingestRuns.id, run.id));
    throw error;
  }
}

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

async function upsertEntities(tx: Tx, batch: SourceBatch): Promise<Map<string, string>> {
  const idByExternal = new Map<string, string>();

  for (const entity of batch.entities) {
    const values = {
      source: entity.source,
      externalId: entity.externalId,
      kind: entity.kind,
      name: entity.name,
      venue: entity.venue,
      venueType: entity.venueType,
      marketType: entity.marketType,
      baseCurrency: entity.baseCurrency,
      inceptionDate: entity.inceptionDate ? toIsoDate(entity.inceptionDate) : null,
      // Hand-assigned, from data/strategy-tags.json. Null until someone
      // classifies it, and null is honest.
      strategyCategory: strategyCategoryFor(entity.source, entity.externalId),
      status: entity.status,
      firstSeenAt: batch.fetchedAt,
      lastSeenAt: batch.fetchedAt,
    };

    const [row] = await tx
      .insert(entities)
      .values(values)
      .onConflictDoUpdate({
        target: [entities.source, entities.externalId],
        set: {
          name: values.name,
          venue: values.venue,
          venueType: values.venueType,
          marketType: values.marketType,
          baseCurrency: values.baseCurrency,
          inceptionDate: values.inceptionDate,
          strategyCategory: values.strategyCategory,
          status: values.status,
          lastSeenAt: values.lastSeenAt,
        },
      })
      .returning({ id: entities.id, externalId: entities.externalId });

    if (!row) {
      throw new Error(`upsert entity failed: ${entity.source}/${entity.externalId}`);
    }
    idByExternal.set(row.externalId, row.id);
  }

  return idByExternal;
}

async function applyDelistings(
  tx: Tx,
  source: string,
  fetchedAt: Date,
  seen: Map<string, string>,
): Promise<void> {
  const existing = await tx
    .select({ id: entities.id, externalId: entities.externalId, status: entities.status })
    .from(entities)
    .where(eq(entities.source, source));

  for (const row of existing) {
    if (seen.has(row.externalId)) continue;
    if (row.status === 'delisted') continue;
    await tx
      .update(entities)
      .set({ status: 'delisted', lastSeenAt: fetchedAt })
      .where(eq(entities.id, row.id));
  }
}

async function applyParents(
  tx: Tx,
  descriptors: EntityDescriptor[],
  idByExternal: Map<string, string>,
): Promise<void> {
  for (const entity of descriptors) {
    if (!entity.parentExternalId) continue;
    const childId = idByExternal.get(entity.externalId);
    const parentId = idByExternal.get(entity.parentExternalId);
    if (!childId || !parentId) continue;
    await tx.update(entities).set({ parentEntityId: parentId }).where(eq(entities.id, childId));
  }
}

/**
 * What a snapshot write needs to know beyond the rows themselves.
 *
 * `archivedAt` is separate from any snapshot's `as_of` on purpose: it is the
 * day the run wrote its payloads to the archive, which for a backfill is
 * today even when the snapshot is from 2023.
 */
interface SnapshotContext {
  source: string;
  fetchedAt: Date;
  archivedAt: Date;
}

/**
 * Postgres caps a statement at 65,535 bound parameters. Ten columns per row
 * leaves headroom well above this, and 500 keeps each statement small enough
 * to stay legible in a query log.
 */
const INSERT_CHUNK = 500;

/**
 * Upsert snapshots, in bulk, without ever overwriting a daily row with a
 * downsampled one.
 *
 * Two layers enforce that last rule. `shouldApplySnapshot` filters in
 * TypeScript, keeping the rule readable and unit-testable in one place, and
 * `setWhere` re-states it in SQL so a concurrent writer cannot slip past the
 * gap between the read and the write. They are equivalent by construction:
 * the only case either rejects is an existing `daily` meeting an incoming
 * `downsampled`.
 *
 * Cost is one read plus a handful of bulk inserts per call, rather than the
 * read-then-write per row this used to do. On the Enzyme universe that was
 * roughly two round-trips times a million.
 */
async function upsertSnapshots(
  tx: Tx,
  ctx: SnapshotContext,
  snapshots: readonly RawSnapshot[],
  idByExternal: Map<string, string>,
): Promise<number> {
  if (snapshots.length === 0) return 0;

  const rows = snapshots.map((snapshot) => {
    const entityId = idByExternal.get(snapshot.externalId);
    if (!entityId) {
      throw new Error(`snapshot for unknown entity ${snapshot.externalId}`);
    }
    return { snapshot, entityId, asOf: toIsoDate(snapshot.asOf) };
  });

  // Existing sampling for exactly the keys about to be written.
  const existing = new Map<string, string>();
  const byEntity = new Map<string, string[]>();
  for (const row of rows) {
    const dates = byEntity.get(row.entityId) ?? [];
    dates.push(row.asOf);
    byEntity.set(row.entityId, dates);
  }

  for (const [entityId, dates] of byEntity) {
    const found = await tx
      .select({ asOf: entitySnapshots.asOf, sampling: entitySnapshots.sampling })
      .from(entitySnapshots)
      .where(
        and(eq(entitySnapshots.entityId, entityId), inArray(entitySnapshots.asOf, [...new Set(dates)])),
      );
    for (const row of found) existing.set(`${entityId}\u0000${row.asOf}`, row.sampling);
  }

  const values: Array<typeof entitySnapshots.$inferInsert> = [];
  let skipped = 0;

  for (const { snapshot, entityId, asOf } of rows) {
    if (!shouldApplySnapshot(existing.get(`${entityId}\u0000${asOf}`), snapshot.sampling)) {
      skipped += 1;
      continue;
    }
    values.push({
      entityId,
      asOf,
      valuePerUnit: money(snapshot.valuePerUnit, 18),
      accountValue: money(snapshot.accountValue, 8),
      cumPnl: money(snapshot.cumPnl, 8),
      aumUsd: money(snapshot.aumUsd, 2),
      sampling: snapshot.sampling,
      navQuality: snapshot.navQuality,
      fetchedAt: ctx.fetchedAt,
      rawRef: snapshotRawRef(snapshot, ctx.source, ctx.archivedAt),
    });
  }

  if (skipped > 0) {
    logger.info('skipped downsampled overwrite of daily snapshots', {
      source: ctx.source,
      skipped,
    });
  }

  for (let start = 0; start < values.length; start += INSERT_CHUNK) {
    await tx
      .insert(entitySnapshots)
      .values(values.slice(start, start + INSERT_CHUNK))
      .onConflictDoUpdate({
        target: [entitySnapshots.entityId, entitySnapshots.asOf],
        set: {
          valuePerUnit: sql.raw('excluded.value_per_unit'),
          accountValue: sql.raw('excluded.account_value'),
          cumPnl: sql.raw('excluded.cum_pnl'),
          aumUsd: sql.raw('excluded.aum_usd'),
          sampling: sql.raw('excluded.sampling'),
          navQuality: sql.raw('excluded.nav_quality'),
          fetchedAt: sql.raw('excluded.fetched_at'),
          rawRef: sql.raw('excluded.raw_ref'),
        },
        setWhere: sql`${entitySnapshots.sampling} <> 'daily' OR ${sql.raw('excluded.sampling')} = 'daily'`,
      });
  }

  return values.length;
}

async function replaceDepositors(
  tx: Tx,
  batch: SourceBatch,
  idByExternal: Map<string, string>,
  asOf: string,
): Promise<void> {
  const byEntity = new Map<string, DepositorRecord[]>();
  for (const row of batch.depositors) {
    const list = byEntity.get(row.externalId) ?? [];
    list.push(row);
    byEntity.set(row.externalId, list);
  }

  for (const [externalId, rows] of byEntity) {
    const entityId = idByExternal.get(externalId);
    if (!entityId) continue;

    await tx
      .delete(depositors)
      .where(and(eq(depositors.entityId, entityId), eq(depositors.asOf, asOf)));

    if (rows.length === 0) continue;

    await tx.insert(depositors).values(
      rows.map((row) => ({
        entityId,
        asOf,
        depositor: row.depositor,
        equity: money(row.equity, 8),
        pnl: money(row.pnl, 8),
        allTimePnl: money(row.allTimePnl, 8),
        daysFollowing: row.daysFollowing ?? null,
        entryTime: row.entryTime ?? null,
        lockupUntil: row.lockupUntil ?? null,
      })),
    );
  }
}

async function applyMetadata(
  tx: Tx,
  batch: SourceBatch,
  idByExternal: Map<string, string>,
  asOf: string,
  yesterday: string,
): Promise<void> {
  for (const entity of batch.entities) {
    const entityId = idByExternal.get(entity.externalId);
    if (!entityId) continue;

    const next: TrackedMetadata = {
      name: entity.name,
      // Tracked in the SCD-2 history too, so a re-tagging is dated and
      // reviewable rather than an untraceable overwrite.
      strategyCategory: strategyCategoryFor(entity.source, entity.externalId),
      feeProfitShare: money(entity.metadata.feeProfitShare, 4),
      feeManagement: money(entity.metadata.feeManagement, 4),
      leaderCommission: money(entity.metadata.leaderCommission, 4),
      status: entity.status,
    };

    const open = await tx
      .select()
      .from(entityMetadataHistory)
      .where(and(eq(entityMetadataHistory.entityId, entityId), isNull(entityMetadataHistory.validTo)))
      .limit(1);

    const current = open[0];
    if (!current) {
      await tx.insert(entityMetadataHistory).values({
        entityId,
        validFrom: asOf,
        validTo: null,
        ...next,
      });
      continue;
    }

    const currentTracked: TrackedMetadata = {
      name: current.name,
      strategyCategory: current.strategyCategory,
      feeProfitShare: current.feeProfitShare,
      feeManagement: current.feeManagement,
      leaderCommission: current.leaderCommission,
      status: current.status,
    };

    if (!metadataChanged(currentTracked, next)) continue;

    if (current.validFrom === asOf) {
      await tx
        .update(entityMetadataHistory)
        .set(next)
        .where(
          and(
            eq(entityMetadataHistory.entityId, entityId),
            eq(entityMetadataHistory.validFrom, asOf),
          ),
        );
      continue;
    }

    await tx
      .update(entityMetadataHistory)
      .set({ validTo: yesterday })
      .where(
        and(eq(entityMetadataHistory.entityId, entityId), isNull(entityMetadataHistory.validTo)),
      );

    await tx.insert(entityMetadataHistory).values({
      entityId,
      validFrom: asOf,
      validTo: null,
      ...next,
    });
  }
}

function money(value: Decimal | undefined, scale: number): string | null {
  if (value === undefined) return null;
  return toNumericString(value, scale);
}

/**
 * Where the payload behind a snapshot actually sits, or null.
 *
 * `archivedAt` is the date the *run* wrote the archive, never the snapshot's
 * own `as_of`. Those differ for every backfilled row — a 2023 point fetched
 * today lives under today's date — and conflating them is how 60,558 Chamber
 * snapshots ended up pointing at `raw/chamber/2023-12-21/...`, a path that had
 * never been written.
 *
 * The name comes from the adapter, which is the only thing that knows it.
 * Without one this returns null: a `raw_ref` that resolves to nothing is worse
 * than an absent one, because null says "no payload recorded" while a wrong
 * path says "here it is" and sends the reader looking.
 */
function snapshotRawRef(snapshot: RawSnapshot, source: string, archivedAt: Date): string | null {
  if (!snapshot.rawName) return null;
  return rawRef(source, archivedAt, snapshot.rawName);
}

export interface BackfillBatch {
  source: string;
  fetchedAt: Date;
  entities: EntityDescriptor[];
  /**
   * Per-entity chunks of history, consumed lazily.
   *
   * An async iterable rather than an array because the array version held the
   * entire universe in memory before writing a single row. That was tolerable
   * for Chamber at 60,558 snapshots and would not be for Enzyme, whose 1,738
   * Ethereum vaults carry daily history back to 2019 — comfortably past a
   * million `RawSnapshot` objects, each holding `Decimal` instances. The job
   * would have died of heap exhaustion after twenty minutes of polite,
   * rate-limited fetching, with nothing written.
   *
   * Yielding per entity bounds resident memory to one vault's history and
   * bounds each transaction to one vault's write.
   */
  snapshots: AsyncIterable<RawSnapshot[]>;
}

/**
 * Historical load. Re-runnable. Does not delist entities (a partial
 * historical pass is not a universe snapshot). Never overwrites a daily
 * snapshot with a downsampled one.
 *
 * Entities are committed first, then each entity's history in its own
 * transaction. That means an interrupted backfill leaves the entities it
 * reached fully written rather than rolling back hours of work, which is what
 * a single universe-wide transaction did. Snapshots are keyed
 * `(entity_id, as_of)` and the job is re-runnable, so resuming is just
 * running it again.
 */
export async function writeBackfillBatch(
  db: Db,
  batch: BackfillBatch,
): Promise<{ runId: string; rowsWritten: number }> {
  const [run] = await db
    .insert(ingestRuns)
    .values({
      source: `${batch.source}:backfill`,
      startedAt: batch.fetchedAt,
      status: 'running',
    })
    .returning({ id: ingestRuns.id });

  if (!run) {
    throw new Error('failed to insert ingest_runs row');
  }

  try {
    const idByExternal = await db.transaction(async (tx) => {
      const ids = await upsertEntities(tx, {
        source: batch.source,
        asOf: batch.fetchedAt,
        fetchedAt: batch.fetchedAt,
        entities: batch.entities,
        snapshots: [],
        depositors: [],
      });
      await applyParents(tx, batch.entities, ids);
      return ids;
    });

    const ctx: SnapshotContext = {
      source: batch.source,
      fetchedAt: batch.fetchedAt,
      // The archive was written under the run's date, not the snapshots'.
      archivedAt: batch.fetchedAt,
    };

    let rowsWritten = 0;
    let chunks = 0;

    for await (const chunk of batch.snapshots) {
      if (chunk.length === 0) continue;
      rowsWritten += await db.transaction((tx) =>
        upsertSnapshots(tx, ctx, chunk, idByExternal),
      );
      chunks += 1;
      if (chunks % 100 === 0) {
        logger.info('backfill progress', { source: batch.source, chunks, rowsWritten });
      }
    }

    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'ok',
        rowsWritten,
        rowsExpected: null,
        error: null,
      })
      .where(eq(ingestRuns.id, run.id));

    logger.info('backfill ok', { source: batch.source, rowsWritten });
    return { runId: run.id, rowsWritten };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'failed',
        rowsWritten: 0,
        error: message,
      })
      .where(eq(ingestRuns.id, run.id));
    throw error;
  }
}

export async function writeBenchmarkPrices(
  db: Db,
  rows: Array<{ symbol: string; asOf: Date; closeUsd: Decimal; source?: string }>,
  fetchedAt: Date,
): Promise<{ runId: string; rowsWritten: number }> {
  const [run] = await db
    .insert(ingestRuns)
    .values({
      source: 'defillama',
      startedAt: fetchedAt,
      status: 'running',
    })
    .returning({ id: ingestRuns.id });

  if (!run) {
    throw new Error('failed to insert ingest_runs row');
  }

  const previous = await db
    .select({ rowsWritten: ingestRuns.rowsWritten })
    .from(ingestRuns)
    .where(and(eq(ingestRuns.source, 'defillama'), eq(ingestRuns.status, 'ok')))
    .orderBy(desc(ingestRuns.finishedAt))
    .limit(1);

  const rowsExpected = previous[0]?.rowsWritten ?? null;
  const rowsWritten = rows.length;
  const band = evaluateRowBand(rowsWritten, rowsExpected);

  if (band === 'aborted') {
    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'aborted',
        rowsWritten,
        rowsExpected,
        error: `row-band abort: written=${rowsWritten} expected=${rowsExpected ?? 'none'}`,
      })
      .where(eq(ingestRuns.id, run.id));
    throw new IngestAbortError(
      `defillama: aborting — rows_written=${rowsWritten} rows_expected=${rowsExpected ?? 'none'}`,
    );
  }

  try {
    await db.transaction(async (tx) => {
      for (const row of rows) {
        const values = {
          symbol: row.symbol,
          asOf: toIsoDate(row.asOf),
          closeUsd: toNumericString(row.closeUsd, 8),
          source: row.source ?? 'defillama',
        };
        await tx
          .insert(benchmarkPrices)
          .values(values)
          .onConflictDoUpdate({
            target: [benchmarkPrices.symbol, benchmarkPrices.asOf],
            set: { closeUsd: values.closeUsd, source: values.source },
          });
      }
    });

    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'ok',
        rowsWritten,
        rowsExpected,
        error: null,
      })
      .where(eq(ingestRuns.id, run.id));

    return { runId: run.id, rowsWritten };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'failed',
        rowsWritten: 0,
        rowsExpected,
        error: message,
      })
      .where(eq(ingestRuns.id, run.id));
    throw error;
  }
}

