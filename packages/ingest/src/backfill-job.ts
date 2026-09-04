import { openDatabase, type Db } from '@vaultbench/db';
import {
  createArchiveFromEnv,
  logger,
  parseIsoDate,
  type RawArchive,
} from '@vaultbench/shared';
import {
  ChamberSource,
  DefiLlamaPriceSource,
  HyperliquidSource,
  OkxSource,
  type EntityDescriptor,
  type RawSnapshot,
} from '@vaultbench/sources';

import { createRawSink } from './archive.js';
import { writeBackfillBatch, writeBenchmarkPrices } from './writer.js';

const BTC_START = '2013-04-28';
const ETH_START = '2015-08-07';
const SOL_START = '2020-04-10';

export async function runBackfill(source: string, date?: string): Promise<void> {
  const { db, close } = openDatabase();
  const archive = createArchiveFromEnv();
  const asOf = date ? parseIsoDate(date) : new Date();

  try {
    if (source === 'all') {
      await backfillHyperliquid(db, archive, asOf);
      await backfillDefillama(db, archive, asOf);
      await backfillOkx(db, archive, asOf);
      await backfillChamber(db, archive, asOf);
    } else if (source === 'hyperliquid') {
      await backfillHyperliquid(db, archive, asOf);
    } else if (source === 'defillama') {
      await backfillDefillama(db, archive, asOf);
    } else if (source === 'okx') {
      await backfillOkx(db, archive, asOf);
    } else if (source === 'chamber') {
      await backfillChamber(db, archive, asOf);
    } else {
      throw new Error(`unknown source: ${source}`);
    }
  } finally {
    await close();
  }
}

async function backfillHyperliquid(db: Db, archive: RawArchive, asOf: Date): Promise<void> {
  const adapter = new HyperliquidSource({
    onRaw: createRawSink(archive, 'hyperliquid', asOf),
    maxVaults: envMaxVaults(),
  });
  const entities = await adapter.listEntities();
  logger.info('hyperliquid backfill universe', { count: entities.length });

  const snapshots: RawSnapshot[] = [];
  if (adapter.backfill) {
    for (const entity of entities) {
      snapshots.push(...(await adapter.backfill(entity.externalId)));
    }
  }

  await writeBackfillBatch(db, {
    source: 'hyperliquid',
    fetchedAt: new Date(),
    entities,
    snapshots,
  });
}

async function backfillDefillama(db: Db, archive: RawArchive, asOf: Date): Promise<void> {
  const adapter = new DefiLlamaPriceSource({
    onRaw: createRawSink(archive, 'defillama', asOf),
  });
  const rows: Array<{ symbol: string; asOf: Date; closeUsd: import('@vaultbench/shared').Decimal }> =
    [];

  for (const [symbol, start] of [
    ['BTC', BTC_START],
    ['ETH', ETH_START],
    ['SOL', SOL_START],
  ] as const) {
    const series = await adapter.history(symbol, parseIsoDate(start), asOf);
    logger.info('defillama backfill', { symbol, points: series.length });
    for (const point of series) {
      rows.push({ symbol, asOf: point.asOf, closeUsd: point.closeUsd });
    }
  }

  await writeBenchmarkPrices(db, rows, new Date());
}

async function backfillOkx(db: Db, archive: RawArchive, asOf: Date): Promise<void> {
  const adapter = new OkxSource({
    onRaw: createRawSink(archive, 'okx', asOf),
  });
  const entities: EntityDescriptor[] = await adapter.listEntities();
  logger.info('okx backfill universe', { count: entities.length });

  const snapshots: RawSnapshot[] = [];
  if (adapter.backfill) {
    for (const entity of entities) {
      const series = await adapter.backfill(entity.externalId);
      snapshots.push(...series);
      const earliest = await adapter.earliestSubpositionDate(entity.externalId);
      logger.info('okx earliest history', {
        externalId: entity.externalId,
        earliest,
        pnlPoints: series.length,
      });
    }
  }

  await writeBackfillBatch(db, {
    source: 'okx',
    fetchedAt: new Date(),
    entities,
    snapshots,
  });
}

/**
 * Chamber history is one request per vault, and the universe runs to
 * thousands across chains. It is a one-shot job, so it plods rather than
 * parallelises — the token bucket in the adapter keeps it polite.
 */
async function backfillChamber(db: Db, archive: RawArchive, asOf: Date): Promise<void> {
  const adapter = new ChamberSource({
    onRaw: createRawSink(archive, 'chamber', asOf),
  });
  const entities = await adapter.listEntities();
  logger.info('chamber backfill universe', { count: entities.length });

  const snapshots: RawSnapshot[] = [];
  for (const entity of entities) {
    snapshots.push(...(await adapter.backfill(entity.externalId)));
  }

  await writeBackfillBatch(db, {
    source: 'chamber',
    fetchedAt: new Date(),
    entities,
    snapshots,
  });
}

function envMaxVaults(): number | undefined {
  if (!process.env.HYPERLIQUID_MAX_VAULTS) return undefined;
  const parsed = Number.parseInt(process.env.HYPERLIQUID_MAX_VAULTS, 10);
  logger.warn('HYPERLIQUID_MAX_VAULTS is set; backfill universe is incomplete', {
    maxVaults: parsed,
  });
  return parsed;
}
