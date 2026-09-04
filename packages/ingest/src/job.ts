import { ingestRuns, type Db } from '@vaultbench/db';
import { logger, parseIsoDate, toIsoDate, utcToday } from '@vaultbench/shared';
import type { RawArchive } from '@vaultbench/shared';
import {
  DefiLlamaPriceSource,
  HyperliquidSource,
  OkxSource,
  type DepositorRecord,
  type PriceSource,
  type Source,
} from '@vaultbench/sources';

import { createRawSink } from './archive.js';
import { IngestAbortError } from './guards.js';
import { writeBenchmarkPrices, writeSourceBatch } from './writer.js';

const ENTITY_SOURCES = ['hyperliquid', 'okx'] as const;
const ALL_SOURCES = ['hyperliquid', 'okx', 'defillama'] as const;

export async function ingestSources(options: {
  db: Db;
  archive: RawArchive;
  source: string;
  date?: string;
}): Promise<void> {
  const asOf = options.date ? parseIsoDate(options.date) : utcToday();
  const requested =
    options.source === 'all' ? [...ALL_SOURCES] : [options.source];

  for (const id of requested) {
    if (id === 'defillama') {
      await ingestDefillama(options.db, options.archive, asOf);
      continue;
    }
    if (id === 'hyperliquid' || id === 'okx') {
      await ingestEntitySource(options.db, options.archive, id, asOf);
      continue;
    }
    throw new Error(`unknown source: ${id}`);
  }
}

async function ingestEntitySource(
  db: Db,
  archive: RawArchive,
  id: (typeof ENTITY_SOURCES)[number],
  asOf: Date,
): Promise<void> {
  const fetchedAt = new Date();
  const onRaw = createRawSink(archive, id, asOf);
  const source = createEntitySource(id, onRaw);

  try {
    logger.info('ingest start', { source: id, asOf: toIsoDate(asOf) });
    const snapshots = await source.snapshot(asOf);
    const entities = await source.listEntities();
    const depositorRows: DepositorRecord[] = [];
    if (source.listDepositors) {
      for (const entity of entities) {
        const rows = await source.listDepositors(entity.externalId);
        depositorRows.push(...rows.map((row) => ({ ...row, asOf })));
      }
    }

    await writeSourceBatch(db, {
      source: id,
      asOf,
      fetchedAt,
      entities,
      snapshots,
      depositors: depositorRows,
    });
  } catch (error) {
    if (error instanceof IngestAbortError) throw error;
    await recordAdapterFailure(db, id, fetchedAt, error);
    throw error;
  }
}

async function ingestDefillama(db: Db, archive: RawArchive, asOf: Date): Promise<void> {
  const fetchedAt = new Date();
  const onRaw = createRawSink(archive, 'defillama', asOf);
  const source: PriceSource = new DefiLlamaPriceSource({ onRaw });
  try {
    logger.info('ingest start', { source: 'defillama', asOf: toIsoDate(asOf) });
    const symbols = ['BTC', 'ETH', 'SOL'] as const;
    const rows = [];
    for (const symbol of symbols) {
      const closeUsd = await source.dailyClose(symbol, asOf);
      rows.push({ symbol, asOf, closeUsd });
    }
    await writeBenchmarkPrices(db, rows, fetchedAt);
  } catch (error) {
    if (error instanceof IngestAbortError) throw error;
    await recordAdapterFailure(db, 'defillama', fetchedAt, error);
    throw error;
  }
}

export function createEntitySource(
  id: 'hyperliquid' | 'okx',
  onRaw?: (name: string, payload: unknown) => Promise<void>,
): Source {
  if (id === 'hyperliquid') {
    const maxVaultsRaw = process.env.HYPERLIQUID_MAX_VAULTS;
    const maxVaults = maxVaultsRaw ? Number.parseInt(maxVaultsRaw, 10) : undefined;
    if (maxVaults !== undefined && !Number.isFinite(maxVaults)) {
      throw new Error('HYPERLIQUID_MAX_VAULTS must be an integer');
    }
    if (maxVaults !== undefined) {
      logger.warn('HYPERLIQUID_MAX_VAULTS is set; the universe is incomplete', {
        maxVaults,
      });
    }
    return new HyperliquidSource({ onRaw, maxVaults });
  }
  return new OkxSource({ onRaw });
}

async function recordAdapterFailure(
  db: Db,
  source: string,
  startedAt: Date,
  error: unknown,
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  logger.error('ingest adapter failed', { source, error: message });
  await db.insert(ingestRuns).values({
    source,
    startedAt,
    finishedAt: new Date(),
    status: 'failed',
    rowsWritten: 0,
    error: message,
  });
}
