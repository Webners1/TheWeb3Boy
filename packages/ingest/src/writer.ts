import { and, desc, eq, isNull, sql } from 'drizzle-orm';
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
      await upsertSnapshots(tx, batch, idByExternal, asOf);
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

async function upsertSnapshots(
  tx: Tx,
  batch: SourceBatch,
  idByExternal: Map<string, string>,
  asOf: string,
): Promise<void> {
  for (const snapshot of batch.snapshots) {
    const entityId = idByExternal.get(snapshot.externalId);
    if (!entityId) {
      throw new Error(`snapshot for unknown entity ${snapshot.externalId}`);
    }

    const existing = await tx
      .select({ sampling: entitySnapshots.sampling })
      .from(entitySnapshots)
      .where(and(eq(entitySnapshots.entityId, entityId), eq(entitySnapshots.asOf, asOf)))
      .limit(1);

    const currentSampling = existing[0]?.sampling;
    if (!shouldApplySnapshot(currentSampling, snapshot.sampling)) {
      logger.info('skip downsampled overwrite of daily snapshot', {
        entityId,
        asOf,
      });
      continue;
    }

    const values = {
      entityId,
      asOf,
      valuePerUnit: money(snapshot.valuePerUnit, 18),
      accountValue: money(snapshot.accountValue, 8),
      cumPnl: money(snapshot.cumPnl, 8),
      aumUsd: money(snapshot.aumUsd, 2),
      sampling: snapshot.sampling,
      navQuality: snapshot.navQuality,
      fetchedAt: batch.fetchedAt,
      rawRef: rawRef(batch.source, batch.asOf, snapshotName(snapshot)),
    };

    await tx
      .insert(entitySnapshots)
      .values(values)
      .onConflictDoUpdate({
        target: [entitySnapshots.entityId, entitySnapshots.asOf],
        set: {
          valuePerUnit: values.valuePerUnit,
          accountValue: values.accountValue,
          cumPnl: values.cumPnl,
          aumUsd: values.aumUsd,
          sampling: values.sampling,
          navQuality: values.navQuality,
          fetchedAt: values.fetchedAt,
          rawRef: values.rawRef,
        },
        setWhere: sql`${entitySnapshots.sampling} <> 'daily' OR ${sql.raw('excluded.sampling')} = 'daily'`,
      });
  }
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

function snapshotName(snapshot: RawSnapshot): string {
  if (snapshot.source === 'hyperliquid') {
    return `vaultDetails/${snapshot.externalId}`;
  }
  if (snapshot.source === 'okx') {
    return `lead-traders/${snapshot.externalId}`;
  }
  return snapshot.externalId;
}

export interface BackfillBatch {
  source: string;
  fetchedAt: Date;
  entities: EntityDescriptor[];
  snapshots: RawSnapshot[];
}

/**
 * Historical load. Re-runnable. Does not delist entities (a partial
 * historical pass is not a universe snapshot). Never overwrites a daily
 * snapshot with a downsampled one.
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
    let rowsWritten = 0;
    await db.transaction(async (tx) => {
      const idByExternal = await upsertEntities(tx, {
        source: batch.source,
        asOf: batch.fetchedAt,
        fetchedAt: batch.fetchedAt,
        entities: batch.entities,
        snapshots: batch.snapshots,
        depositors: [],
      });
      await applyParents(tx, batch.entities, idByExternal);
      for (const snapshot of batch.snapshots) {
        const asOf = toIsoDate(snapshot.asOf);
        await upsertSnapshots(
          tx,
          {
            source: batch.source,
            asOf: snapshot.asOf,
            fetchedAt: batch.fetchedAt,
            entities: batch.entities,
            snapshots: [snapshot],
            depositors: [],
          },
          idByExternal,
          asOf,
        );
        rowsWritten += 1;
      }
    });

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

