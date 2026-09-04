import { and, desc, eq } from 'drizzle-orm';
import { ingestRuns, type Db } from '@vaultbench/db';
import {
  DEFAULT_WINDOWS,
  computeEntityMetrics,
  deriveFlows,
  deriveNavSeries,
  type EntityMetrics,
} from '@vaultbench/core';
import { RunAbortError, evaluateRowBand, logger, toIsoDate } from '@vaultbench/shared';

import { isSourceRankable } from './fees.js';
import { loadBenchmarks, loadEntities, loadFeeProfile, loadLatestDepositors, loadSnapshots } from './load.js';
import { replaceFlows, replaceNav, seedMetricDefinitions, upsertMetrics } from './write.js';

export interface RecomputeOptions {
  db: Db;
  /** Restrict to one source, e.g. `hyperliquid`. Omit for every entity. */
  source?: string;
  /**
   * Window end date. Omit to use each entity's own latest observation, which
   * is what keeps a delisted entity's final metrics intact instead of
   * recomputing it into an empty window.
   */
  asOf?: Date;
  windows?: readonly number[];
}

export interface RecomputeResult {
  runId: string;
  entitiesProcessed: number;
  entitiesSkipped: number;
  navRows: number;
  flowRows: number;
  metricRows: number;
  definitions: number;
}

/**
 * Rebuild every derived table from the raw snapshots.
 *
 * Reads raw, writes derived, and nothing else. The maths itself lives in
 * `@vaultbench/core` and never sees a database handle — this module is only
 * the wiring between the two.
 */
export async function recompute(options: RecomputeOptions): Promise<RecomputeResult> {
  const { db } = options;
  const windows = options.windows ?? DEFAULT_WINDOWS;
  const startedAt = new Date();
  const runSource = options.source === undefined ? 'compute' : `compute:${options.source}`;

  const [run] = await db
    .insert(ingestRuns)
    .values({ source: runSource, startedAt, status: 'running' })
    .returning({ id: ingestRuns.id });

  if (!run) {
    throw new Error('failed to insert ingest_runs row');
  }

  try {
    const definitions = await seedMetricDefinitions(db);
    const benchmarks = await loadBenchmarks(db);
    const entityRows = await loadEntities(db, options.source);

    let entitiesProcessed = 0;
    let entitiesSkipped = 0;
    let navRows = 0;
    let flowRows = 0;
    let metricRows = 0;

    for (const entity of entityRows) {
      const snapshots = await loadSnapshots(db, entity.id);
      if (snapshots.length === 0) {
        entitiesSkipped += 1;
        continue;
      }

      const nav = deriveNavSeries(snapshots);
      const flows = deriveFlows(snapshots);
      const last = nav.points[nav.points.length - 1];
      if (last === undefined) {
        entitiesSkipped += 1;
        continue;
      }

      const endAsOf = options.asOf === undefined ? last.asOf : toIsoDate(options.asOf);
      const fees = await loadFeeProfile(db, entity.id, entity.source);
      const cross = await loadLatestDepositors(db, entity.id);
      // A cross-section captured after the window end says nothing about the
      // window, so it is not attached to it.
      const depositors = cross !== undefined && cross.asOf <= endAsOf ? cross.rows : undefined;

      // Headline eligibility is the conjunction of two independent
      // judgements: is this kind of number rankable at all (core's rule on
      // nav_quality), and do we trust this venue's field semantics yet
      // (compute's venue policy). Either one saying no is a no.
      const rankable = isSourceRankable(entity.source);
      const metrics: EntityMetrics[] = windows.map((windowDays) => {
        const row = computeEntityMetrics({
          nav: nav.points,
          endAsOf,
          windowDays,
          benchmarks,
          ...(depositors === undefined ? {} : { depositors }),
          fees,
        });
        return { ...row, headlineEligible: row.headlineEligible && rankable };
      });

      const computedAt = new Date();
      await db.transaction(async (tx) => {
        navRows += await replaceNav(tx, entity.id, nav.points, computedAt);
        flowRows += await replaceFlows(tx, entity.id, flows, computedAt);
        metricRows += await upsertMetrics(tx, entity.id, metrics, computedAt);
      });

      entitiesProcessed += 1;
      if (nav.breaks > 0) {
        logger.info('nav chain truncated at a wipeout', {
          entityId: entity.id,
          externalId: entity.externalId,
          breaks: nav.breaks,
        });
      }
    }

    const previous = await db
      .select({ rowsWritten: ingestRuns.rowsWritten })
      .from(ingestRuns)
      .where(and(eq(ingestRuns.source, runSource), eq(ingestRuns.status, 'ok')))
      .orderBy(desc(ingestRuns.finishedAt))
      .limit(1);

    const rowsExpected = previous[0]?.rowsWritten ?? null;
    const band = evaluateRowBand(metricRows, rowsExpected);

    if (band === 'aborted') {
      await db
        .update(ingestRuns)
        .set({
          finishedAt: new Date(),
          status: 'aborted',
          rowsWritten: metricRows,
          rowsExpected,
          error: `row-band abort: written=${metricRows} expected=${rowsExpected ?? 'none'}`,
        })
        .where(eq(ingestRuns.id, run.id));
      throw new RunAbortError(
        `${runSource}: aborting — metric rows=${metricRows} expected=${rowsExpected ?? 'none'}`,
      );
    }

    await db
      .update(ingestRuns)
      .set({
        finishedAt: new Date(),
        status: 'ok',
        rowsWritten: metricRows,
        rowsExpected,
        error: null,
      })
      .where(eq(ingestRuns.id, run.id));

    logger.info('recompute ok', {
      source: runSource,
      entitiesProcessed,
      entitiesSkipped,
      navRows,
      flowRows,
      metricRows,
    });

    return {
      runId: run.id,
      entitiesProcessed,
      entitiesSkipped,
      navRows,
      flowRows,
      metricRows,
      definitions,
    };
  } catch (error) {
    if (error instanceof RunAbortError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(ingestRuns)
      .set({ finishedAt: new Date(), status: 'failed', rowsWritten: 0, error: message })
      .where(eq(ingestRuns.id, run.id));
    throw error;
  }
}
