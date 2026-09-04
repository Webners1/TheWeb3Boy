import {
  dateFromEpochMillis,
  fetchJson,
  parseDecimal,
  toIsoDate,
  unixSecondsUtc,
  type Decimal,
} from '@vaultbench/shared';

import type { AdapterHooks, PriceSource } from '../types.js';
import { parseOrThrow } from '../parse.js';
import {
  LLAMA_COINS,
  llamaChartSchema,
  llamaHistoricalSchema,
  type BenchmarkSymbol,
} from './schemas.js';

const COINS_BASE = 'https://coins.llama.fi';
const CHART_SPAN = 500;

export interface DefiLlamaPriceSourceOptions extends AdapterHooks {
  baseUrl?: string;
  fetchJson?: typeof fetchJson;
}

/**
 * DefiLlama coins API — free, no auth, no rate limit for normal traffic.
 * Populates benchmark_prices only; this is not an entity source.
 */
export class DefiLlamaPriceSource implements PriceSource {
  readonly id = 'defillama';
  private readonly baseUrl: string;
  private readonly fetch: typeof fetchJson;
  private readonly onRaw?: AdapterHooks['onRaw'];

  constructor(options: DefiLlamaPriceSourceOptions = {}) {
    this.baseUrl = options.baseUrl ?? COINS_BASE;
    this.fetch = options.fetchJson ?? fetchJson;
    this.onRaw = options.onRaw;
  }

  async dailyClose(symbol: string, date: Date): Promise<Decimal> {
    const coin = coinId(symbol);
    const unix = unixSecondsUtc(date);
    const url = `${this.baseUrl}/prices/historical/${unix}/${coin}`;
    const raw = await this.fetch(url);
    await this.onRaw?.(`historical/${symbol}/${toIsoDate(date)}`, raw);
    const parsed = parseOrThrow(llamaHistoricalSchema, raw, `defillama historical ${symbol}`);
    const coinPrice = parsed.coins[coin];
    if (!coinPrice) {
      throw new Error(`defillama: missing price for ${symbol} on ${toIsoDate(date)}`);
    }
    return parseDecimal(coinPrice.price);
  }

  async history(
    symbol: string,
    from: Date,
    to: Date,
  ): Promise<Array<{ asOf: Date; closeUsd: Decimal }>> {
    const coin = coinId(symbol);
    const points: Array<{ asOf: Date; closeUsd: Decimal }> = [];
    let cursor = Math.floor(from.getTime() / 1000);

    while (cursor <= unixSecondsUtc(to)) {
      const url = `${this.baseUrl}/chart/${coin}?start=${cursor}&span=${CHART_SPAN}&period=1d`;
      const raw = await this.fetch(url);
      await this.onRaw?.(`chart/${symbol}/${cursor}`, raw);
      const parsed = parseOrThrow(llamaChartSchema, raw, `defillama chart ${symbol}`);
      const series = parsed.coins[coin]?.prices ?? [];
      if (series.length === 0) break;

      for (const point of series) {
        const asOf = dateFromEpochMillis(point.timestamp * 1000);
        if (asOf < from || asOf > to) continue;
        points.push({ asOf, closeUsd: parseDecimal(point.price) });
      }

      const last = series[series.length - 1];
      if (!last) break;
      const next = last.timestamp + 86_400;
      if (next <= cursor) break;
      cursor = next;
    }

    return dedupeByDate(points);
  }
}

export function coinId(symbol: string): string {
  const key = symbol.toUpperCase() as BenchmarkSymbol;
  const id = LLAMA_COINS[key];
  if (!id) {
    throw new Error(`unsupported benchmark symbol: ${symbol}`);
  }
  return id;
}

function dedupeByDate(
  points: Array<{ asOf: Date; closeUsd: Decimal }>,
): Array<{ asOf: Date; closeUsd: Decimal }> {
  const byDate = new Map<string, { asOf: Date; closeUsd: Decimal }>();
  for (const point of points) {
    byDate.set(toIsoDate(point.asOf), point);
  }
  return [...byDate.values()].sort((a, b) => a.asOf.getTime() - b.asOf.getTime());
}
