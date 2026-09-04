import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  benchmarkPrices,
  depositors,
  entities,
  entityFlows,
  entityMetrics,
  entityNav,
  metricDefinitions,
  type Db,
} from '@vaultbench/db';
import { applyMigrations } from '@vaultbench/db/testing';
import { INCEPTION_WINDOW } from '@vaultbench/core';

import { createApp } from './app.js';

const now = new Date('2026-02-01T00:00:00Z');

/**
 * Two entities: one healthy and rankable, one dead and not.
 *
 * The dead one is the point of most of these tests. A leaderboard that
 * silently drops it looks better and lies, so the default list has to keep
 * it and the tests have to prove that.
 */
async function seed(): Promise<{ db: Db; live: string; dead: string }> {
  const client = new PGlite();
  await applyMigrations(client);
  const db = drizzle(client) as unknown as Db;

  const inserted = await db
    .insert(entities)
    .values([
      {
        source: 'hyperliquid',
        externalId: '0xlive',
        kind: 'vault',
        name: 'Live Vault',
        venue: 'hyperliquid',
        venueType: 'dex',
        marketType: 'perp',
        baseCurrency: 'USDC',
        strategyCategory: 'neutral',
        inceptionDate: '2026-01-01',
        status: 'active',
        firstSeenAt: now,
        lastSeenAt: now,
      },
      {
        source: 'okx',
        externalId: 'swap:dead',
        kind: 'lead_trader',
        name: 'Dead Lead',
        venue: 'okx',
        venueType: 'cex',
        marketType: 'perp',
        baseCurrency: 'USDT',
        status: 'delisted',
        firstSeenAt: now,
        lastSeenAt: now,
      },
    ])
    .returning({ id: entities.id, externalId: entities.externalId });

  const live = inserted.find((row) => row.externalId === '0xlive')?.id;
  const dead = inserted.find((row) => row.externalId === 'swap:dead')?.id;
  if (live === undefined || dead === undefined) throw new Error('seed failed');

  await db.insert(entityNav).values(
    [
      ['2026-01-01', '1.000000000000000000'],
      ['2026-01-02', '1.100000000000000000'],
      ['2026-01-03', '1.050000000000000000'],
      ['2026-01-04', '1.210000000000000000'],
    ].map(([asOf, valuePerUnit]) => ({
      entityId: live,
      asOf: asOf as string,
      valuePerUnit: valuePerUnit as string,
      navQuality: 'derived',
      method: 'dietz',
      sampling: 'daily',
      computedAt: now,
    })),
  );

  await db.insert(entityFlows).values({
    entityId: live,
    asOf: '2026-01-03',
    netFlowUsd: '10000.00000000',
    computedAt: now,
  });

  await db.insert(entityMetrics).values([
    {
      entityId: live,
      asOf: '2026-01-04',
      windowDays: INCEPTION_WINDOW,
      twr: '0.2100000000',
      benchTwrBtc: '0.1000000000',
      alphaBtc: '0.1100000000',
      maxDrawdown: '-0.0454545455',
      followerMedianReturn: '0.1000000000',
      followerGap: '0.1100000000',
      daysCovered: 4,
      isFullWindow: true,
      sampling: 'daily',
      navQuality: 'derived',
      headlineEligible: true,
      feesApplied: true,
      computedAt: now,
    },
    {
      entityId: live,
      asOf: '2026-01-04',
      windowDays: 90,
      twr: '0.2100000000',
      daysCovered: 4,
      isFullWindow: false,
      sampling: 'daily',
      navQuality: 'derived',
      headlineEligible: true,
      feesApplied: true,
      computedAt: now,
    },
    {
      entityId: dead,
      asOf: '2026-01-04',
      windowDays: INCEPTION_WINDOW,
      twr: '9.0000000000',
      daysCovered: 2,
      isFullWindow: false,
      sampling: 'downsampled',
      navQuality: 'roi',
      headlineEligible: false,
      feesApplied: false,
      computedAt: now,
    },
  ]);

  await db.insert(benchmarkPrices).values(
    [
      ['2026-01-01', '100000.00000000'],
      ['2026-01-02', '104000.00000000'],
      ['2026-01-03', '102000.00000000'],
      ['2026-01-04', '110000.00000000'],
    ].map(([asOf, closeUsd]) => ({
      symbol: 'BTC',
      asOf: asOf as string,
      closeUsd: closeUsd as string,
      source: 'defillama',
    })),
  );

  await db.insert(depositors).values([
    {
      entityId: live,
      asOf: '2026-01-04',
      depositor: '0xf1',
      equity: '110.00000000',
      pnl: '10.00000000',
      allTimePnl: '10.00000000',
      daysFollowing: 3,
    },
    {
      entityId: live,
      asOf: '2026-01-04',
      depositor: '0xf2',
      equity: '105.00000000',
      pnl: '5.00000000',
      allTimePnl: '5.00000000',
      daysFollowing: 2,
    },
    {
      // Withdrew a winning position in full: equity 0 with positive lifetime
      // PnL implies a negative cost basis, so there is no honest return to
      // compute. A depositor at equity 0 with a *loss* is different — that is
      // a real -100% and is counted.
      entityId: live,
      asOf: '2026-01-04',
      depositor: '0xf3',
      equity: '0.00000000',
      pnl: '20.00000000',
      allTimePnl: '20.00000000',
      daysFollowing: 1,
    },
  ]);

  await db.insert(metricDefinitions).values({
    key: 'twr',
    label: 'Time-weighted return',
    description: 'Return with deposits and withdrawals removed.',
    unit: 'fraction',
    direction: 'higher_better',
    caveats: 'Downsampled series hide intra-sample drawdowns.',
  });

  return { db, live, dead };
}

let db: Db;
let live: string;
let dead: string;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  const seeded = await seed();
  db = seeded.db;
  live = seeded.live;
  dead = seeded.dead;
  app = createApp({ db });
});

async function get(path: string): Promise<{ status: number; body: any }> {
  const response = await app.request(`http://localhost${path}`);
  const text = await response.text();
  return { status: response.status, body: text.length > 0 ? JSON.parse(text) : null };
}

describe('GET /entities', () => {
  it('serves dead entities by default, because hiding them is the bias', async () => {
    const { body } = await get('/entities');
    const names = body.entities.map((entity: { name: string }) => entity.name);
    expect(names).toContain('Dead Lead');
    expect(body.pagination.total).toBe(2);
  });

  it('takes an explicit filter to hide them', async () => {
    const { body } = await get('/entities?status=active');
    expect(body.entities).toHaveLength(1);
    expect(body.entities[0].name).toBe('Live Vault');
  });

  it('attaches coverage to every figure it returns', async () => {
    const { body } = await get('/entities');
    for (const entity of body.entities) {
      expect(entity.metrics.coverage).toMatchObject({
        windowDays: expect.any(Number),
        daysCovered: expect.any(Number),
        isFullWindow: expect.any(Boolean),
        sampling: expect.any(String),
        headlineEligible: expect.any(Boolean),
      });
    }
  });

  it('can exclude figures that must not be ranked', async () => {
    // The dead lead has the best twr in the fixture (900%) and is exactly the
    // row a naive leaderboard would put at the top.
    const unfiltered = await get('/entities?sort=twr&direction=desc');
    expect(unfiltered.body.entities[0].name).toBe('Dead Lead');

    const ranked = await get('/entities?sort=twr&direction=desc&headlineEligible=true');
    expect(ranked.body.entities).toHaveLength(1);
    expect(ranked.body.entities[0].name).toBe('Live Vault');
  });

  it('does not mix windows: a 90-day request gets the 90-day row', async () => {
    const { body } = await get(`/entities?window=90&status=active`);
    expect(body.windowDays).toBe(90);
    expect(body.entities[0].metrics.coverage.windowDays).toBe(90);
    expect(body.entities[0].metrics.coverage.isFullWindow).toBe(false);
  });

  it('emits returns as exact strings, never JSON numbers', async () => {
    const { body } = await get('/entities?status=active');
    expect(body.entities[0].metrics.twr).toBe('0.21');
    expect(typeof body.entities[0].metrics.twr).toBe('string');
  });

  it('filters on a hand-assigned strategy category', async () => {
    const matched = await get('/entities?strategyCategory=neutral');
    expect(matched.body.entities).toHaveLength(1);
    const none = await get('/entities?strategyCategory=yield');
    expect(none.body.entities).toHaveLength(0);
  });

  it('rejects an unknown strategy category rather than ignoring it', async () => {
    // Silently returning everything would look like "no vaults match".
    const { status } = await get('/entities?strategyCategory=momentum');
    expect(status).toBe(400);
  });

  it('caps page size', async () => {
    expect((await get('/entities?limit=500')).status).toBe(400);
  });
});

describe('GET /entities/{id}', () => {
  it('returns one metrics row per window', async () => {
    const { body } = await get(`/entities/${live}`);
    expect(body.metrics.map((row: { coverage: { windowDays: number } }) => row.coverage.windowDays))
      .toEqual([0, 90]);
  });

  it('404s an unknown id', async () => {
    expect((await get('/entities/00000000-0000-4000-8000-000000000000')).status).toBe(404);
  });

  it('400s an id that is not a uuid', async () => {
    expect((await get('/entities/not-a-uuid')).status).toBe(400);
  });
});

describe('GET /entities/{id}/series', () => {
  it('publishes the flows that were removed alongside the series', async () => {
    const { body } = await get(`/entities/${live}/series`);
    expect(body.points).toHaveLength(4);
    // The 10,000 deposit is disclosed, which is what makes the flat NAV
    // across that date checkable rather than merely asserted.
    expect(body.flows).toEqual([{ asOf: '2026-01-03', netFlowUsd: '10000' }]);
  });

  it('honours a date range', async () => {
    const { body } = await get(`/entities/${live}/series?from=2026-01-03`);
    expect(body.points.map((point: { asOf: string }) => point.asOf)).toEqual([
      '2026-01-03',
      '2026-01-04',
    ]);
  });
});

describe('GET /compare', () => {
  it('rebases both legs to 100 on their shared start date', async () => {
    const { body } = await get(`/compare?entity=${live}&bench=BTC`);
    expect(body.startAsOf).toBe('2026-01-01');
    expect(body.entity[0].value).toBe('100');
    // The benchmark starts marginally below 100: it paid 10bp to get in.
    expect(body.benchmarks.BTC[0].value).toBe('99.9');
  });

  it('charges the benchmark an entry cost so the chart matches the alpha figure', async () => {
    const { body } = await get(`/compare?entity=${live}&bench=BTC`);
    const last = body.benchmarks.BTC.at(-1).value;
    // 110000/100000 * 0.999 * 100 = 109.89, i.e. +9.89% not +10%.
    expect(last).toBe('109.89');
  });

  it('carries the method disclosure in the payload, not just the docs', async () => {
    const { body } = await get(`/compare?entity=${live}&bench=BTC`);
    expect(body.note).toMatch(/indexed to 100/i);
    expect(body.note).toMatch(/10bp/);
  });

  it('carries coverage so a short window cannot be read as a full one', async () => {
    const { body } = await get(`/compare?entity=${live}&bench=BTC&window=90`);
    expect(body.coverage.isFullWindow).toBe(false);
    expect(body.coverage.daysCovered).toBe(4);
  });

  it('omits a benchmark it has no prices for rather than inventing one', async () => {
    const { body } = await get(`/compare?entity=${live}&bench=BTC,ETH,SOL`);
    expect(Object.keys(body.benchmarks)).toEqual(['BTC']);
  });
});

describe('GET /entities/{id}/followers', () => {
  it('reports the gap between the entity and its median follower', async () => {
    const { body } = await get(`/entities/${live}/followers`);
    expect(body.medianReturn).toBe('0.1');
    expect(body.count).toBe(3);
  });

  it('lists a depositor with no computable return but excludes it from percentiles', async () => {
    const { body } = await get(`/entities/${live}/followers`);
    // All three are disclosed; only two have an honest return, so the
    // percentiles are drawn from two rather than from a fabricated third.
    expect(body.followers).toHaveLength(3);
    expect(body.p25Return).toBe('0.05');
    expect(body.p75Return).toBe('0.1');
  });

  it('discloses that follower returns are money-weighted', async () => {
    const { body } = await get(`/entities/${live}/followers`);
    expect(body.note).toMatch(/money-weighted/i);
  });
});

describe('GET /metrics/definitions', () => {
  it('serves semantics from the database, not from the codebase', async () => {
    const { body } = await get('/metrics/definitions');
    expect(body.definitions[0].key).toBe('twr');
    expect(body.definitions[0].caveats).toMatch(/downsampled/i);
  });

  it('advertises which windows actually have data', async () => {
    const { body } = await get('/metrics/definitions');
    expect(body.windows).toEqual([0, 90]);
  });
});

describe('spec', () => {
  it('serves an OpenAPI 3.1 document', async () => {
    const { body } = await get('/openapi.json');
    expect(body.openapi).toBe('3.1.0');
    expect(Object.keys(body.paths)).toContain('/compare');
  });
});
