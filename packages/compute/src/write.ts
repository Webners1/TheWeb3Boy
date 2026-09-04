import { eq } from 'drizzle-orm';
import {
  entityFlows,
  entityMetrics,
  entityNav,
  metricDefinitions,
  type Db,
} from '@vaultbench/db';
import { logger, toNumericString, type Decimal } from '@vaultbench/shared';
import { METRIC_DEFINITIONS, type EntityMetrics, type FlowPoint, type NavPoint } from '@vaultbench/core';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** Scale of the `rate` columns in entity_metrics. */
const RATE_SCALE = 10;

/**
 * numeric(20,10) holds ten integer digits. A dust-NAV vault can produce a
 * return above that, and a Postgres overflow would abort the whole recompute
 * over one absurd row. Such a row is stored as null: a gap is honest, a
 * clamped 999999.9999999999 is a fabricated number.
 */
const RATE_LIMIT = '1e10';

/**
 * Replace an entity's derived NAV series wholesale.
 *
 * A rebuild rather than an upsert: if a fix to the derivation drops points —
 * a wipeout now truncating the chain, say — an upsert would leave the old
 * points behind and quietly blend two generations of maths.
 */
export async function replaceNav(
  tx: Tx,
  entityId: string,
  points: readonly NavPoint[],
  computedAt: Date,
): Promise<number> {
  await tx.delete(entityNav).where(eq(entityNav.entityId, entityId));
  if (points.length === 0) return 0;

  await tx.insert(entityNav).values(
    points.map((point) => ({
      entityId,
      asOf: point.asOf,
      valuePerUnit: toNumericString(point.valuePerUnit, 18),
      navQuality: point.navQuality,
      method: point.method,
      sampling: point.sampling,
      computedAt,
    })),
  );
  return points.length;
}

export async function replaceFlows(
  tx: Tx,
  entityId: string,
  flows: readonly FlowPoint[],
  computedAt: Date,
): Promise<number> {
  await tx.delete(entityFlows).where(eq(entityFlows.entityId, entityId));
  if (flows.length === 0) return 0;

  await tx.insert(entityFlows).values(
    flows.map((flow) => ({
      entityId,
      asOf: flow.asOf,
      netFlowUsd: toNumericString(flow.netFlowUsd, 8),
      computedAt,
    })),
  );
  return flows.length;
}

export async function upsertMetrics(
  tx: Tx,
  entityId: string,
  rows: readonly EntityMetrics[],
  computedAt: Date,
): Promise<number> {
  for (const row of rows) {
    const values = {
      entityId,
      asOf: row.asOf,
      windowDays: row.windowDays,
      twr: rate(row.twr),
      benchTwrBtc: rate(row.benchTwrBtc),
      benchTwrEth: rate(row.benchTwrEth),
      benchTwrSol: rate(row.benchTwrSol),
      alphaBtc: rate(row.alphaBtc),
      alphaEth: rate(row.alphaEth),
      alphaSol: rate(row.alphaSol),
      betaBtc: rate(row.betaBtc),
      betaEth: rate(row.betaEth),
      betaSol: rate(row.betaSol),
      rSquaredBtc: rate(row.rSquaredBtc),
      rSquaredEth: rate(row.rSquaredEth),
      rSquaredSol: rate(row.rSquaredSol),
      maxDrawdown: rate(row.maxDrawdown),
      volatility: rate(row.volatility),
      followerMedianReturn: rate(row.followerMedianReturn),
      followerGap: rate(row.followerGap),
      daysCovered: row.daysCovered,
      isFullWindow: row.isFullWindow,
      sampling: row.sampling,
      navQuality: row.navQuality ?? null,
      headlineEligible: row.headlineEligible,
      feesApplied: row.feesApplied,
      computedAt,
    };

    await tx
      .insert(entityMetrics)
      .values(values)
      .onConflictDoUpdate({
        target: [entityMetrics.entityId, entityMetrics.asOf, entityMetrics.windowDays],
        set: values,
      });
  }
  return rows.length;
}

/**
 * Push the metric semantics into the database.
 *
 * "Semantics live in the database" is only true if something writes them, and
 * the definitions are versioned in `packages/core` alongside the maths that
 * produces them — so a metric whose meaning changes cannot ship without its
 * description changing in the same commit.
 */
export async function seedMetricDefinitions(db: Db): Promise<number> {
  for (const definition of METRIC_DEFINITIONS) {
    await db
      .insert(metricDefinitions)
      .values(definition)
      .onConflictDoUpdate({
        target: metricDefinitions.key,
        set: {
          label: definition.label,
          description: definition.description,
          unit: definition.unit,
          direction: definition.direction,
          caveats: definition.caveats,
        },
      });
  }
  return METRIC_DEFINITIONS.length;
}

function rate(value: Decimal | undefined): string | null {
  if (value === undefined) return null;
  if (value.abs().gte(RATE_LIMIT)) {
    logger.warn('metric out of numeric range, storing null', { value: value.toFixed() });
    return null;
  }
  return toNumericString(value, RATE_SCALE);
}
