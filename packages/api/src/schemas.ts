import { z } from '@hono/zod-openapi';

/**
 * Every money value, return and ratio crosses the wire as a **decimal
 * string**, never a JSON number.
 *
 * A JSON number is an IEEE-754 double. Emitting `0.1` as a number and asking
 * a client to add it up reintroduces exactly the floating-point error the
 * database's `numeric` columns exist to avoid, and it would do so at the one
 * boundary we do not control. The rule that holds everywhere else in this
 * repo has to hold here too or it is not a rule.
 */
export const decimalString = z.string().openapi({
  description: 'Exact decimal, as a string. Never parse this as a float.',
  example: '0.1432',
});

export const isoDate = z.string().openapi({ example: '2026-09-04', description: 'UTC date.' });

export const samplingSchema = z.enum(['daily', 'downsampled']).openapi({
  description:
    'How dense the underlying series is. `downsampled` series come from venue history ' +
    'endpoints that thin older points, so a drawdown between two samples is invisible.',
});

export const navQualitySchema = z.enum(['reported', 'derived', 'roi']).openapi({
  description:
    '`reported` — the venue published a true per-unit NAV or share price. ' +
    '`derived` — reconstructed from account value net of flows. ' +
    '`roi` — the venue published only a money-weighted return; not time-weighted ' +
    'and never ranked against the other two.',
});

/**
 * Coverage. Required, on purpose.
 *
 * AGENTS.md: "Never publish a number you cannot defend. Every headline figure
 * carries days_covered, is_full_window and sampling." Making these optional
 * would let a client render a 90-day return built from 4 days of data with
 * nothing on screen to say so, which is the failure mode this whole project
 * is a correction of. `openapi.test.ts` asserts they stay required.
 */
export const coverageSchema = z
  .object({
    windowDays: z.number().int().openapi({
      description: 'Requested window. 0 means since inception.',
      example: 90,
    }),
    daysCovered: z.number().int().openapi({
      description: 'Days of data actually present in the window.',
      example: 62,
    }),
    isFullWindow: z.boolean().openapi({
      description: 'False when the entity is younger than the window, or data is missing.',
    }),
    sampling: samplingSchema,
    navQuality: navQualitySchema.nullable(),
    headlineEligible: z.boolean().openapi({
      description:
        'False when the figure must not be ranked against others — money-weighted ROI, ' +
        'or a venue whose field semantics are not yet verified.',
    }),
    feesApplied: z.boolean().openapi({
      description:
        'True when a fee haircut was applied because the venue reports gross. False when ' +
        'the venue already reports net, or no fee schedule is recorded.',
    }),
  })
  .openapi('Coverage');

export const entitySchema = z
  .object({
    id: z.string().uuid(),
    source: z.string().openapi({ example: 'hyperliquid' }),
    externalId: z.string().openapi({ example: '0xdfc24b077bc1425ad1dea75bcb6f8158e10df303' }),
    kind: z.string().openapi({ example: 'vault' }),
    name: z.string(),
    venue: z.string(),
    venueType: z.string().openapi({ example: 'dex' }),
    marketType: z.string().openapi({ example: 'perp' }),
    strategyCategory: z.string().nullable().openapi({
      description:
        'Hand-assigned. Null means unclassified, not uncategorisable — read it before ' +
        'calling a market-neutral vault an underperformer for trailing BTC.',
      example: 'neutral',
    }),
    baseCurrency: z.string(),
    inceptionDate: isoDate.nullable(),
    status: z.string().openapi({
      description:
        '`active`, `closed` or `delisted`. Dead entities are retained deliberately: ' +
        'dropping them is how a leaderboard invents survivorship bias.',
      example: 'active',
    }),
    provenance: z.string().openapi({
      description:
        '`api`, `partner` or `scraped`. A scraped entity is stored but never ' +
        'headline-ranked beside an API-derived one.',
      example: 'api',
    }),
    copyMode: z.string().nullable().openapi({
      description: '`classic`, `pro`, `tradfi`, `spot`, `futures`, `bot`, or null.',
    }),
    positionsVisible: z.boolean().nullable().openapi({
      description: 'False when the venue keeps the lead\'s positions opaque (e.g. Bybit Pro).',
    }),
    managerStakeRatio: decimalString.nullable().openapi({
      description:
        'Manager capital at risk as a fraction of vault equity. Drift: ' +
        '(totalShares − userShares) / totalShares. Hyperliquid: leaderFraction.',
    }),
    pendingRedemptionsUsd: decimalString.nullable(),
    firstSeenAt: z.string(),
    lastSeenAt: z.string(),
  })
  .openapi('Entity');

export const metricsSchema = z
  .object({
    asOf: isoDate,
    twr: decimalString.nullable().openapi({
      description: 'Time-weighted return over the window, net of fees where applicable.',
    }),
    benchTwrBtc: decimalString.nullable(),
    benchTwrEth: decimalString.nullable(),
    benchTwrSol: decimalString.nullable(),
    alphaBtc: decimalString.nullable().openapi({
      description:
        'twr − benchTwrBtc. Not a skill measure on its own: read betaBtc alongside it, ' +
        'because a leveraged long on BTC produces large alpha of either sign purely from ' +
        'gearing.',
    }),
    alphaEth: decimalString.nullable(),
    alphaSol: decimalString.nullable(),
    betaBtc: decimalString.nullable().openapi({
      description:
        "Slope of the entity's returns against BTC's over the same window. 1 tracks, 3 is " +
        'roughly 3x geared, 0 is market-neutral, negative is short. Null means the figure ' +
        'is not computable, not zero.',
    }),
    betaEth: decimalString.nullable(),
    betaSol: decimalString.nullable(),
    rSquaredBtc: decimalString.nullable().openapi({
      description:
        'Share of variance BTC explains, 0 to 1. Tells you whether betaBtc is gearing or ' +
        'coincidence: beta 3 at r² 0.98 is a leveraged tracker, beta 3 at r² 0.05 is noise.',
    }),
    rSquaredEth: decimalString.nullable(),
    rSquaredSol: decimalString.nullable(),
    maxDrawdown: decimalString.nullable(),
    volatility: decimalString.nullable().openapi({
      description: 'Annualised standard deviation of period returns.',
    }),
    followerMedianReturn: decimalString.nullable(),
    followerGap: decimalString.nullable().openapi({
      description:
        "The entity's return minus its median follower's. Negative means followers did " +
        'worse than the headline figure suggests.',
    }),
    coverage: coverageSchema,
  })
  .openapi('Metrics');

export const entityWithMetricsSchema = entitySchema
  .extend({ metrics: metricsSchema.nullable() })
  .openapi('EntityWithMetrics');

export const navPointSchema = z
  .object({
    asOf: isoDate,
    valuePerUnit: decimalString,
    navQuality: navQualitySchema,
    method: z.enum(['reported', 'simple', 'dietz']).openapi({
      description:
        'How the point was produced. `dietz` means a flow occurred and its intra-period ' +
        'timing was unknown, so the denominator is mid-period weighted.',
    }),
    sampling: samplingSchema,
  })
  .openapi('NavPoint');

export const flowPointSchema = z
  .object({ asOf: isoDate, netFlowUsd: decimalString.nullable() })
  .openapi('FlowPoint');

export const seriesSchema = z
  .object({
    entityId: z.string().uuid(),
    points: z.array(navPointSchema),
    flows: z.array(flowPointSchema),
  })
  .openapi('Series');

export const indexPointSchema = z
  .object({
    asOf: isoDate,
    value: decimalString.openapi({
      description: 'Rebased to 100 at the first date common to every series in the response.',
      example: '112.4',
    }),
  })
  .openapi('IndexPoint');

export const comparisonSchema = z
  .object({
    entityId: z.string().uuid(),
    /** Every series in one response starts on the same date. */
    startAsOf: isoDate.nullable(),
    endAsOf: isoDate.nullable(),
    entity: z.array(indexPointSchema),
    benchmarks: z.record(z.string(), z.array(indexPointSchema)).openapi({
      description: 'Keyed by symbol. Each series is aligned to the same start date as the entity.',
    }),
    coverage: coverageSchema.nullable(),
    note: z.string().openapi({
      description: 'Method disclosure that must be shown wherever the chart is shown.',
    }),
  })
  .openapi('Comparison');

export const followerSchema = z
  .object({
    depositor: z.string(),
    equity: decimalString.nullable(),
    pnl: decimalString.nullable(),
    allTimePnl: decimalString.nullable(),
    daysFollowing: z.number().int().nullable(),
    entryTime: z.string().nullable(),
  })
  .openapi('Follower');

export const followersSchema = z
  .object({
    entityId: z.string().uuid(),
    asOf: isoDate.nullable(),
    count: z.number().int(),
    medianReturn: decimalString.nullable(),
    p25Return: decimalString.nullable(),
    p75Return: decimalString.nullable(),
    followers: z.array(followerSchema),
    note: z.string(),
  })
  .openapi('Followers');

export const metricDefinitionSchema = z
  .object({
    key: z.string(),
    label: z.string().nullable(),
    description: z.string().nullable(),
    unit: z.string().nullable(),
    direction: z.string().nullable(),
    caveats: z.string().nullable().openapi({
      description: 'When this metric misleads. Read it before ranking on the metric.',
    }),
  })
  .openapi('MetricDefinition');

export const errorSchema = z
  .object({ error: z.string(), detail: z.string().optional() })
  .openapi('Error');

export const paginationSchema = z
  .object({ limit: z.number().int(), offset: z.number().int(), total: z.number().int() })
  .openapi('Pagination');
