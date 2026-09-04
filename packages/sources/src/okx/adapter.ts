import {
  dateFromEpochMillis,
  fetchJson,
  parseDecimal,
  toIsoDate,
  TokenBucket,
} from '@vaultbench/shared';

import type {
  AdapterHooks,
  DepositorRecord,
  EntityDescriptor,
  MarketType,
  RawSnapshot,
  Source,
} from '../types.js';
import { parseOrThrow } from '../parse.js';
import {
  okxCopyTradersSchema,
  okxDailyPnlSchema,
  okxLeadTradersPageSchema,
  okxSubpositionHistorySchema,
  type OkxInstType,
  type OkxLeadRank,
} from './schemas.js';

const DEFAULT_BASE = 'https://www.okx.com';

/** A rank, plus the archive key of the page it arrived in. */
interface RankEntry {
  instType: OkxInstType;
  rank: OkxLeadRank;
  rawName: string;
}

/**
 * OKX public copy-trading adapter.
 *
 * Documented rate limits (OKX API v5, "Order book trading > Copy trading",
 * retrieved 2026-09-04 from https://www.okx.com/docs-v5/en/):
 *
 *   GET /api/v5/copytrading/public-config                 5 req / 2s, IP
 *   GET /api/v5/copytrading/public-lead-traders           5 req / 2s, IP
 *   GET /api/v5/copytrading/public-weekly-pnl             5 req / 2s, IP
 *   GET /api/v5/copytrading/public-pnl                    5 req / 2s, IP
 *   GET /api/v5/copytrading/public-stats                  5 req / 2s, IP
 *   GET /api/v5/copytrading/public-preference-currency    5 req / 2s, IP
 *   GET /api/v5/copytrading/public-current-subpositions   5 req / 2s, IP
 *   GET /api/v5/copytrading/public-subpositions-history   5 req / 2s, IP
 *   GET /api/v5/copytrading/public-copy-traders           5 req / 2s, IP
 *
 * All of the public copy-trading endpoints used here are 5 requests per 2
 * seconds, keyed by IP. We throttle to 2 req/s to stay under that.
 *
 * TODO: OKX redistribution / commercial-use terms need legal review before
 * any paid product is built on this feed. Public endpoints are unauthenticated
 * but the ToS still govern redistribution of their data.
 */
export class OkxSource implements Source {
  readonly id = 'okx';
  private readonly baseUrl: string;
  private readonly fetch: typeof fetchJson;
  private readonly onRaw?: AdapterHooks['onRaw'];
  private readonly bucket = new TokenBucket(2, 2);
  private ranks: RankEntry[] | null = null;

  constructor(options: AdapterHooks & { baseUrl?: string; fetchJson?: typeof fetchJson } = {}) {
    this.baseUrl = (options.baseUrl ?? process.env.OKX_API_BASE ?? DEFAULT_BASE).replace(/\/$/, '');
    this.fetch = options.fetchJson ?? fetchJson;
    this.onRaw = options.onRaw;
  }

  async listEntities(): Promise<EntityDescriptor[]> {
    const ranks = await this.loadRanks();
    return ranks.map(({ instType, rank }) => toDescriptor(instType, rank));
  }

  async snapshot(date: Date): Promise<RawSnapshot[]> {
    const ranks = await this.loadRanks();
    return ranks.map(({ instType, rank, rawName }) => ({
      source: this.id,
      externalId: externalId(instType, rank.uniqueCode),
      asOf: date,
      accountValue: parseDecimal(rank.aum),
      cumPnl: parseDecimal(rank.pnl),
      aumUsd: parseDecimal(rank.aum),
      sampling: 'daily' as const,
      navQuality: 'raw' as const,
      rawName,
    }));
  }

  async backfill(externalIdValue: string): Promise<RawSnapshot[]> {
    const parsed = parseExternalId(externalIdValue);
    const raw = await this.get(
      '/api/v5/copytrading/public-pnl',
      { instType: parsed.instType, uniqueCode: parsed.uniqueCode, lastDays: '4' },
      `pnl/${externalIdValue}`,
    );
    const parsedPnl = parseOrThrow(okxDailyPnlSchema, raw, `okx public-pnl ${externalIdValue}`);
    assertOkxCode(parsedPnl.code, `okx public-pnl ${externalIdValue}`);

    return parsedPnl.data.map((row) => ({
      source: this.id,
      externalId: externalIdValue,
      asOf: dateFromEpochMillis(row.beginTs),
      cumPnl: parseDecimal(row.pnl),
      sampling: 'daily' as const,
      navQuality: 'raw' as const,
      rawName: `pnl/${externalIdValue}`,
    }));
  }

  async listDepositors(externalIdValue: string): Promise<DepositorRecord[]> {
    const parsed = parseExternalId(externalIdValue);
    const raw = await this.get(
      '/api/v5/copytrading/public-copy-traders',
      { instType: parsed.instType, uniqueCode: parsed.uniqueCode, limit: '100' },
      `copy-traders/${externalIdValue}`,
    );
    const parsedCopies = parseOrThrow(
      okxCopyTradersSchema,
      raw,
      `okx copy-traders ${externalIdValue}`,
    );
    assertOkxCode(parsedCopies.code, `okx copy-traders ${externalIdValue}`);

    const asOf = new Date();
    const out: DepositorRecord[] = [];
    for (const group of parsedCopies.data) {
      for (const trader of group.copyTraders) {
        out.push({
          source: this.id,
          externalId: externalIdValue,
          asOf,
          depositor: trader.nickName,
          pnl: parseDecimal(trader.pnl),
          entryTime: dateFromEpochMillis(trader.beginCopyTime),
        });
      }
    }
    return out;
  }

  async earliestSubpositionDate(externalIdValue: string): Promise<string | undefined> {
    const parsed = parseExternalId(externalIdValue);
    const raw = await this.get(
      '/api/v5/copytrading/public-subpositions-history',
      { instType: parsed.instType, uniqueCode: parsed.uniqueCode, limit: '100' },
      `subpositions-history/${externalIdValue}`,
    );
    const parsedHist = parseOrThrow(
      okxSubpositionHistorySchema,
      raw,
      `okx subpositions-history ${externalIdValue}`,
    );
    assertOkxCode(parsedHist.code, `okx subpositions-history ${externalIdValue}`);
    let earliest: number | undefined;
    for (const row of parsedHist.data) {
      const ts = row.openTime ?? row.closeTime;
      if (ts === undefined) continue;
      if (earliest === undefined || ts < earliest) earliest = ts;
    }
    return earliest === undefined ? undefined : toIsoDate(dateFromEpochMillis(earliest));
  }

  private async loadRanks(): Promise<RankEntry[]> {
    if (this.ranks) return this.ranks;

    const combined: RankEntry[] = [];
    for (const instType of ['SPOT', 'SWAP'] as const) {
      for (const entry of await this.paginateRanks(instType)) {
        combined.push({ instType, ...entry });
      }
    }
    this.ranks = combined;
    return combined;
  }

  /**
   * Ranks paired with the archive key each one arrived in.
   *
   * The page number is part of that key, so it has to be captured here — by
   * the time `loadRanks` has flattened the pages it is gone, and a snapshot
   * would have no way to say which payload it came from.
   */
  private async paginateRanks(
    instType: OkxInstType,
  ): Promise<Array<{ rank: OkxLeadRank; rawName: string }>> {
    const ranks: Array<{ rank: OkxLeadRank; rawName: string }> = [];
    let page = 1;
    let totalPage = 1;
    let dataVer: string | undefined;

    while (page <= totalPage) {
      const query: Record<string, string> = {
        instType,
        page: String(page),
        limit: '20',
      };
      if (dataVer) query.dataVer = dataVer;

      const rawName = `lead-traders/${instType}/page-${page}`;
      const raw = await this.get(
        '/api/v5/copytrading/public-lead-traders',
        query,
        rawName,
      );
      const parsed = parseOrThrow(
        okxLeadTradersPageSchema,
        raw,
        `okx lead-traders ${instType} page ${page}`,
      );
      assertOkxCode(parsed.code, `okx lead-traders ${instType}`);
      const block = parsed.data[0];
      if (!block) break;
      dataVer = block.dataVer;
      totalPage = Number.parseInt(block.totalPage, 10);
      if (!Number.isFinite(totalPage) || totalPage < 1) {
        throw new Error(`okx lead-traders ${instType}: invalid totalPage ${block.totalPage}`);
      }
      for (const rank of block.ranks) ranks.push({ rank, rawName });
      page += 1;
    }

    return ranks;
  }

  private async get(
    path: string,
    query: Record<string, string>,
    archiveName: string,
  ): Promise<unknown> {
    const url = new URL(path, `${this.baseUrl}/`);
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
    const raw = await this.fetch(url.toString(), { bucket: this.bucket });
    await this.onRaw?.(archiveName, raw);
    return raw;
  }
}

function toDescriptor(instType: OkxInstType, rank: OkxLeadRank): EntityDescriptor {
  const marketType: MarketType = instType === 'SPOT' ? 'spot' : 'perp';
  return {
    source: 'okx',
    externalId: externalId(instType, rank.uniqueCode),
    kind: 'lead_trader',
    name: rank.nickName,
    venue: 'okx',
    venueType: 'cex',
    marketType,
    baseCurrency: rank.ccy,
    status: 'active',
    metadata: {},
  };
}

export function externalId(instType: OkxInstType, uniqueCode: string): string {
  return `${instType.toLowerCase()}:${uniqueCode}`;
}

export function parseExternalId(value: string): { instType: OkxInstType; uniqueCode: string } {
  const sep = value.indexOf(':');
  if (sep <= 0) {
    throw new Error(`okx external id must be spot:CODE or swap:CODE, got ${value}`);
  }
  const kind = value.slice(0, sep).toUpperCase();
  const uniqueCode = value.slice(sep + 1);
  if (kind !== 'SPOT' && kind !== 'SWAP') {
    throw new Error(`okx external id has unknown market ${kind}`);
  }
  return { instType: kind, uniqueCode };
}

function assertOkxCode(code: string, label: string): void {
  if (code !== '0') {
    throw new Error(`${label}: okx error code ${code}`);
  }
}
