import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { Db } from '@vaultbench/db';
import { INCEPTION_WINDOW, depositorReturn, rebaseSeries } from '@vaultbench/core';
import { Decimal, parseDecimal } from '@vaultbench/shared';

import {
  allMetricDefinitions,
  availableWindows,
  benchmarkCloses,
  findEntity,
  flowSeries,
  latestFollowers,
  latestSnapshotExtras,
  listEntities,
  metricsForEntity,
  metricsForWindow,
  navSeries,
  type EntityFilter,
  type SortKey,
} from './queries.js';
import {
  presentEntity,
  presentFlow,
  presentMetrics,
  presentNavPoint,
  trimNumeric,
} from './present.js';
import {
  comparisonSchema,
  entitySchema,
  entityWithMetricsSchema,
  errorSchema,
  followersSchema,
  metricDefinitionSchema,
  metricsSchema,
  paginationSchema,
  seriesSchema,
} from './schemas.js';

/**
 * Shown alongside every benchmark comparison, in the payload rather than in
 * the frontend, so an integrator who renders the chart cannot render it
 * without the method disclosure. The whole argument of this project is that
 * the comparison is only honest if the method is visible.
 */
const COMPARISON_NOTE =
  'Both series are indexed to 100 on the first date they share. The benchmark is ' +
  'buy-and-hold from that date, net of a 10bp entry swap cost, and is charged no ' +
  'ongoing fee. Read coverage.sampling and coverage.isFullWindow before comparing: ' +
  'a downsampled series hides drawdowns between samples.';

const FOLLOWERS_NOTE =
  'The freshest depositor cross-section available, not a historical one — it decays ' +
  'as depositors exit, so it understates churn. Returns are per-depositor lifetime ' +
  'PnL over current equity, which is money-weighted and not comparable to the ' +
  "entity's time-weighted return.";

const idParam = z.object({
  id: z.string().uuid().openapi({ param: { name: 'id', in: 'path' } }),
});

const windowQuery = z.object({
  window: z.coerce
    .number()
    .int()
    .nonnegative()
    .default(INCEPTION_WINDOW)
    .openapi({ param: { name: 'window', in: 'query' }, example: 90 }),
});

const rangeQuery = z.object({
  from: z.string().optional().openapi({ param: { name: 'from', in: 'query' } }),
  to: z.string().optional().openapi({ param: { name: 'to', in: 'query' } }),
});

function json<T extends z.ZodType>(description: string, schema: T) {
  return { description, content: { 'application/json': { schema } } };
}

const notFound = json('Entity not found.', errorSchema);

export interface AppOptions {
  db: Db;
  /** Advertised in the spec so a client knows where the canonical host is. */
  serverUrl?: string;
}

export function createApp(options: AppOptions): OpenAPIHono {
  const { db } = options;
  const app = new OpenAPIHono({
    defaultHook: (result, c) => {
      // A bad query string is a 400 with the reason, not a 500. Zod already
      // knows exactly what was wrong; passing that through saves the caller
      // guessing at our parameter names.
      if (!result.success) {
        return c.json({ error: 'invalid_request', detail: result.error.message }, 400);
      }
      return undefined;
    },
  });

  app.openapi(
    createRoute({
      method: 'get',
      path: '/entities',
      tags: ['entities'],
      summary: 'List entities with their metrics for one window',
      description:
        'Closed and delisted entities are included by default. Pass `status=active` to ' +
        'exclude them, and understand that doing so reintroduces survivorship bias: ' +
        'the dead entities are the ones a leaderboard never shows you.',
      request: {
        query: windowQuery.extend({
          source: z.string().optional().openapi({ param: { name: 'source', in: 'query' } }),
          kind: z.string().optional().openapi({ param: { name: 'kind', in: 'query' } }),
          status: z.string().optional().openapi({ param: { name: 'status', in: 'query' } }),
          marketType: z
            .string()
            .optional()
            .openapi({ param: { name: 'marketType', in: 'query' } }),
          strategyCategory: z
            .enum(['directional', 'neutral', 'yield'])
            .optional()
            .openapi({ param: { name: 'strategyCategory', in: 'query' } }),
          headlineEligible: z
            .enum(['true', 'false'])
            .optional()
            .openapi({ param: { name: 'headlineEligible', in: 'query' } }),
          fullWindow: z
            .enum(['true', 'false'])
            .optional()
            .openapi({ param: { name: 'fullWindow', in: 'query' } }),
          sort: z
            .enum(['twr', 'alphaBtc', 'maxDrawdown', 'volatility', 'followerGap', 'name'])
            .default('twr')
            .openapi({ param: { name: 'sort', in: 'query' } }),
          direction: z
            .enum(['asc', 'desc'])
            .default('desc')
            .openapi({ param: { name: 'direction', in: 'query' } }),
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(200)
            .default(50)
            .openapi({ param: { name: 'limit', in: 'query' } }),
          offset: z.coerce
            .number()
            .int()
            .nonnegative()
            .default(0)
            .openapi({ param: { name: 'offset', in: 'query' } }),
        }),
      },
      responses: {
        200: json(
          'Entities and their newest metrics row for the window.',
          z.object({
            windowDays: z.number().int(),
            pagination: paginationSchema,
            entities: z.array(entityWithMetricsSchema),
          }),
        ),
        400: json('Invalid query.', errorSchema),
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const filter: EntityFilter = {
        ...(query.source === undefined ? {} : { source: query.source }),
        ...(query.kind === undefined ? {} : { kind: query.kind }),
        ...(query.status === undefined ? {} : { status: query.status }),
        ...(query.marketType === undefined ? {} : { marketType: query.marketType }),
        ...(query.strategyCategory === undefined
          ? {}
          : { strategyCategory: query.strategyCategory }),
        ...(query.headlineEligible === 'true' ? { headlineEligibleOnly: true } : {}),
        ...(query.fullWindow === 'true' ? { fullWindowOnly: true } : {}),
      };

      const { rows, total } = await listEntities(db, {
        windowDays: query.window,
        filter,
        sort: query.sort as SortKey,
        direction: query.direction,
        limit: query.limit,
        offset: query.offset,
      });
      const extras = await latestSnapshotExtras(
        db,
        rows.map((row) => row.entity.id),
      );

      return c.json(
        {
          windowDays: query.window,
          pagination: { limit: query.limit, offset: query.offset, total },
          entities: rows.map((row) => ({
            ...presentEntity(row.entity, extras.get(row.entity.id)),
            metrics: row.metrics === null ? null : presentMetrics(row.metrics),
          })),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/entities/{id}',
      tags: ['entities'],
      summary: 'One entity with every window it has metrics for',
      request: { params: idParam },
      responses: {
        200: json(
          'The entity and one metrics row per window.',
          entitySchema.extend({ metrics: z.array(metricsSchema) }),
        ),
        404: notFound,
      },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const entity = await findEntity(db, id);
      if (entity === undefined) return c.json({ error: 'not_found' }, 404);

      const metrics = await metricsForEntity(db, id);
      const extras = await latestSnapshotExtras(db, [id]);
      return c.json(
        { ...presentEntity(entity, extras.get(id)), metrics: metrics.map(presentMetrics) },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/entities/{id}/series',
      tags: ['entities'],
      summary: 'The derived per-unit value series, and the flows removed from it',
      description:
        'The flows are returned alongside on purpose: they are what was subtracted to ' +
        'stop a deposit reading as a gain, and publishing them is what makes the ' +
        'per-unit series checkable rather than merely asserted.',
      request: { params: idParam, query: rangeQuery },
      responses: { 200: json('Per-unit series and flows.', seriesSchema), 404: notFound },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const range = c.req.valid('query');
      const entity = await findEntity(db, id);
      if (entity === undefined) return c.json({ error: 'not_found' }, 404);

      const [points, flows] = await Promise.all([
        navSeries(db, id, range),
        flowSeries(db, id, range),
      ]);

      return c.json(
        {
          entityId: id,
          points: points.map(presentNavPoint),
          flows: flows.map(presentFlow),
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/compare',
      tags: ['compare'],
      summary: 'An entity against buy-and-hold benchmarks, on one index base',
      request: {
        query: z.object({
          entity: z.string().uuid().openapi({ param: { name: 'entity', in: 'query' } }),
          bench: z
            .string()
            .default('BTC,ETH,SOL')
            .openapi({ param: { name: 'bench', in: 'query' }, example: 'BTC,ETH' }),
          window: z.coerce
            .number()
            .int()
            .nonnegative()
            .default(INCEPTION_WINDOW)
            .openapi({ param: { name: 'window', in: 'query' } }),
        }),
      },
      responses: {
        200: json('Aligned, rebased series.', comparisonSchema),
        400: json('Invalid query.', errorSchema),
        404: notFound,
      },
    }),
    async (c) => {
      const query = c.req.valid('query');
      const entity = await findEntity(db, query.entity);
      if (entity === undefined) return c.json({ error: 'not_found' }, 404);

      const symbols = query.bench
        .split(',')
        .map((symbol) => symbol.trim().toUpperCase())
        .filter((symbol) => symbol.length > 0);

      const points = await navSeries(db, query.entity, {});
      const metrics = await metricsForWindow(db, query.entity, query.window);

      // The window is honoured by trimming the NAV series, so the comparison
      // covers exactly the period the metrics describe.
      const windowed =
        query.window === INCEPTION_WINDOW
          ? points
          : points.filter((point) => {
              const last = points[points.length - 1];
              if (last === undefined) return false;
              const cutoff = new Date(last.asOf);
              cutoff.setUTCDate(cutoff.getUTCDate() - query.window);
              return point.asOf >= cutoff.toISOString().slice(0, 10);
            });

      const start = windowed[0]?.asOf;
      const end = windowed[windowed.length - 1]?.asOf;

      const closes =
        start === undefined || end === undefined
          ? []
          : await benchmarkCloses(db, symbols, { from: start, to: end });

      const comparison = rebaseSeries({
        entity: windowed.map((point) => ({ asOf: point.asOf, value: point.valuePerUnit })),
        benchmarks: closes.map((row) => ({
          symbol: row.symbol,
          asOf: row.asOf,
          value: row.closeUsd,
        })),
      });

      return c.json(
        {
          entityId: query.entity,
          startAsOf: comparison.startAsOf,
          endAsOf: comparison.endAsOf,
          entity: comparison.entity,
          benchmarks: comparison.benchmarks,
          coverage: metrics === undefined ? null : presentMetrics(metrics).coverage,
          note: COMPARISON_NOTE,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/entities/{id}/followers',
      tags: ['entities'],
      summary: 'The depositor cross-section and its return distribution',
      description:
        'The gap between an entity\'s return and its median follower\'s is the number ' +
        'that matters to somebody deciding whether to copy it, and it is the number no ' +
        'venue publishes.',
      request: {
        params: idParam,
        query: z.object({
          limit: z.coerce
            .number()
            .int()
            .min(1)
            .max(500)
            .default(100)
            .openapi({ param: { name: 'limit', in: 'query' } }),
        }),
      },
      responses: { 200: json('Followers and distribution.', followersSchema), 404: notFound },
    }),
    async (c) => {
      const { id } = c.req.valid('param');
      const { limit } = c.req.valid('query');
      const entity = await findEntity(db, id);
      if (entity === undefined) return c.json({ error: 'not_found' }, 404);

      const latest = await latestFollowers(db, id);
      const metrics = await metricsForEntity(db, id);
      const inception = metrics.find((row) => row.windowDays === INCEPTION_WINDOW) ?? metrics[0];
      const distribution = latest === undefined ? [] : followerReturns(latest.rows);

      return c.json(
        {
          entityId: id,
          asOf: latest?.asOf ?? null,
          count: latest?.rows.length ?? 0,
          medianReturn: trimNumeric(inception?.followerMedianReturn ?? null),
          p25Return: percentile(distribution, 0.25),
          p75Return: percentile(distribution, 0.75),
          followers: (latest?.rows ?? []).slice(0, limit).map((row) => ({
            depositor: row.depositor,
            equity: trimNumeric(row.equity),
            pnl: trimNumeric(row.pnl),
            allTimePnl: trimNumeric(row.allTimePnl),
            daysFollowing: row.daysFollowing,
            entryTime: row.entryTime === null ? null : row.entryTime.toISOString(),
          })),
          note: FOLLOWERS_NOTE,
        },
        200,
      );
    },
  );

  app.openapi(
    createRoute({
      method: 'get',
      path: '/metrics/definitions',
      tags: ['metrics'],
      summary: 'What every metric means, and when it misleads',
      description:
        'Served from the `metric_definitions` table, not from this codebase. A metric ' +
        'only a frontend can interpret is invisible to an agent, so the semantics live ' +
        'in the database next to the numbers.',
      responses: {
        200: json(
          'Metric semantics.',
          z.object({
            windows: z.array(z.number().int()).openapi({
              description: 'Windows that currently have computed metrics. 0 is since inception.',
            }),
            definitions: z.array(metricDefinitionSchema),
          }),
        ),
      },
    }),
    async (c) => {
      const [definitions, windows] = await Promise.all([
        allMetricDefinitions(db),
        availableWindows(db),
      ]);
      return c.json({ windows, definitions }, 200);
    },
  );

  app.get('/health', (c) => c.json({ status: 'ok' }));

  app.doc31('/openapi.json', openApiConfig(options.serverUrl));

  return app;
}

export function openApiConfig(serverUrl?: string) {
  return {
    openapi: '3.1.0',
    info: {
      title: 'VaultBench API',
      version: '0.1.0',
      description:
        'Crypto vault and copy-trading performance measured against BTC/ETH/SOL ' +
        'buy-and-hold, on a time-weighted basis with flows removed.\n\n' +
        'Two rules govern every response:\n\n' +
        '1. **Money is a string.** Returns, ratios and money values are exact decimal ' +
        'strings. A JSON number is a float and would reintroduce the error the ' +
        "database's numeric columns exist to avoid.\n" +
        '2. **Coverage travels with every figure.** Every metrics object carries ' +
        '`coverage` with `daysCovered`, `isFullWindow`, `sampling`, `navQuality` and ' +
        '`headlineEligible`. A 90-day return built from 4 days of downsampled data is ' +
        'reported as such rather than presented as a 90-day return.\n\n' +
        'Closed and delisted entities are served by default. Excluding them is what ' +
        'makes a leaderboard flattering and wrong.',
    },
    servers: [{ url: serverUrl ?? 'http://localhost:8787' }],
    tags: [
      { name: 'entities', description: 'Vaults and copy-trading leaders.' },
      { name: 'compare', description: 'Entity versus buy-and-hold benchmark.' },
      { name: 'metrics', description: 'Metric semantics and caveats.' },
    ],
  };
}

/**
 * Per-depositor lifetime returns, ascending.
 *
 * The ratio itself comes from `core.depositorReturn` rather than being
 * recomputed here — one definition of a depositor's return, shared by the
 * recompute job and this endpoint, so the percentiles below can never drift
 * from the `followerMedianReturn` stored in `entity_metrics`.
 */
function followerReturns(
  rows: readonly { equity: string | null; allTimePnl: string | null }[],
): Decimal[] {
  const returns: Decimal[] = [];
  for (const row of rows) {
    const value = depositorReturn({
      depositor: '',
      ...(row.equity === null ? {} : { equity: parseDecimal(row.equity) }),
      ...(row.allTimePnl === null ? {} : { allTimePnl: parseDecimal(row.allTimePnl) }),
    });
    if (value !== undefined) returns.push(value);
  }
  return returns.sort((left, right) => left.cmp(right));
}

function percentile(sorted: readonly Decimal[], fraction: number): string | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.floor(fraction * sorted.length));
  return sorted[index]?.toFixed() ?? null;
}
