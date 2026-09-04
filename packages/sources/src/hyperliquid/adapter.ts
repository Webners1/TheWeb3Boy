import {
  dateFromEpochMillis,
  decimalFromJsonNumber,
  fetchJson,
  parseDecimal,
  toIsoDate,
  TokenBucket,
  mapPool,
} from '@vaultbench/shared';

import type {
  AdapterHooks,
  DepositorRecord,
  EntityDescriptor,
  RawSnapshot,
  Source,
} from '../types.js';
import {
  vaultDetailsSchema,
  vaultStatsRegistrySchema,
  vaultSummariesSchema,
  type VaultDetails,
  type VaultStatsEntry,
} from './schemas.js';
import { parseOrThrow } from '../parse.js';

const STATS_URL = 'https://stats-data.hyperliquid.xyz/Mainnet/vaults';
const INFO_URL = 'https://api.hyperliquid.xyz/info';

export interface HyperliquidSourceOptions extends AdapterHooks {
  statsUrl?: string;
  infoUrl?: string;
  fetchJson?: typeof fetchJson;
  /** Test-only cap. Never set this in production — the universe must be complete. */
  maxVaults?: number;
  requestConcurrency?: number;
}

/**
 * Hyperliquid vault adapter.
 *
 * Discovery uses the stats-data registry, NOT `vaultSummaries`. Hyperliquid's
 * docs state vaultSummaries returns vaults less than 2 hours old — it is a
 * new-vault feed. We still call it and merge any addresses the hourly stats
 * snapshot has not yet picked up.
 *
 * Rate limit: 1200 request weight / minute / IP. Client-side token bucket at
 * ~10 req/s with exponential backoff on 429.
 */
export class HyperliquidSource implements Source {
  readonly id = 'hyperliquid';
  private readonly statsUrl: string;
  private readonly infoUrl: string;
  private readonly fetch: typeof fetchJson;
  private readonly onRaw?: AdapterHooks['onRaw'];
  private readonly maxVaults?: number;
  private readonly concurrency: number;
  private readonly bucket = new TokenBucket(10, 10);

  private registry: VaultStatsEntry[] | null = null;
  private detailsByAddress = new Map<string, VaultDetails>();
  private parentByChild = new Map<string, string>();

  constructor(options: HyperliquidSourceOptions = {}) {
    this.statsUrl = options.statsUrl ?? STATS_URL;
    this.infoUrl = options.infoUrl ?? INFO_URL;
    this.fetch = options.fetchJson ?? fetchJson;
    this.onRaw = options.onRaw;
    this.maxVaults = options.maxVaults;
    this.concurrency = options.requestConcurrency ?? 8;
  }

  async listEntities(): Promise<EntityDescriptor[]> {
    const registry = await this.loadRegistry();
    return registry.map((entry) => this.toDescriptor(entry));
  }

  async snapshot(date: Date): Promise<RawSnapshot[]> {
    const registry = await this.loadRegistry();
    const details = await this.loadAllDetails(registry);
    const snapshots: RawSnapshot[] = [];

    for (const entry of registry) {
      const detail = details.get(entry.summary.vaultAddress);
      if (!detail) continue;
      const point = dayPointOnDate(detail, date);
      if (!point) continue;
      snapshots.push({
        source: this.id,
        externalId: entry.summary.vaultAddress,
        asOf: date,
        accountValue: parseDecimal(point.accountValue),
        cumPnl: parseDecimal(point.cumPnl),
        aumUsd: parseDecimal(entry.summary.tvl),
        sampling: 'daily',
        navQuality: 'raw',
        // The day point comes from the per-vault detail call, not the
        // summaries list.
        rawName: `vaultDetails/${entry.summary.vaultAddress}`,
      });
    }

    return snapshots;
  }

  async backfill(externalId: string): Promise<RawSnapshot[]> {
    const address = externalId.toLowerCase();
    const detail = await this.loadDetails(address);
    const allTime = bucket(detail, 'allTime');
    if (!allTime) return [];

    const pnlByTs = new Map(allTime.pnlHistory.map(([ts, value]) => [ts, value]));
    const snapshots: RawSnapshot[] = [];

    for (const [ts, accountValue] of allTime.accountValueHistory) {
      const cumPnl = pnlByTs.get(ts);
      snapshots.push({
        source: this.id,
        externalId: address,
        asOf: dateFromEpochMillis(ts),
        accountValue: parseDecimal(accountValue),
        cumPnl: cumPnl === undefined ? undefined : parseDecimal(cumPnl),
        sampling: 'downsampled',
        navQuality: 'raw',
        rawName: `vaultDetails/${address}`,
      });
    }

    return snapshots;
  }

  async listDepositors(externalId: string): Promise<DepositorRecord[]> {
    const address = externalId.toLowerCase();
    const detail = await this.loadDetails(address);
    const asOf = new Date();
    return detail.followers.map((follower) => ({
      source: this.id,
      externalId: address,
      asOf,
      depositor: normalizeDepositor(follower.user),
      equity: parseDecimal(follower.vaultEquity),
      pnl: parseDecimal(follower.pnl),
      allTimePnl: parseDecimal(follower.allTimePnl),
      daysFollowing: follower.daysFollowing,
      entryTime: dateFromEpochMillis(follower.vaultEntryTime),
      lockupUntil: dateFromEpochMillis(follower.lockupUntil),
    }));
  }

  private async loadRegistry(): Promise<VaultStatsEntry[]> {
    if (this.registry) return this.registry;

    const rawStats = await this.fetch(this.statsUrl, {
      bucket: this.bucket,
      timeoutMs: 120_000,
    });
    await this.onRaw?.('vaults', rawStats);
    const parsed = parseOrThrow(vaultStatsRegistrySchema, rawStats, 'hyperliquid stats vaults');

    const rawSummaries = await this.fetch(this.infoUrl, {
      method: 'POST',
      body: { type: 'vaultSummaries' },
      bucket: this.bucket,
    });
    await this.onRaw?.('vaultSummaries', rawSummaries);
    const summaries = parseOrThrow(
      vaultSummariesSchema,
      rawSummaries,
      'hyperliquid vaultSummaries',
    );

    const byAddress = new Map(parsed.map((entry) => [entry.summary.vaultAddress, entry]));
    for (const summary of summaries) {
      if (byAddress.has(summary.vaultAddress)) continue;
      byAddress.set(summary.vaultAddress, {
        apr: 0,
        pnls: [],
        summary: {
          name: summary.name,
          vaultAddress: summary.vaultAddress,
          leader: summary.leader,
          tvl: summary.tvl,
          isClosed: summary.isClosed ?? false,
          relationship: summary.relationship ?? { type: 'normal' },
          createTimeMillis: summary.createTimeMillis ?? 0,
        },
      });
    }

    const parentByChild = new Map<string, string>();
    for (const entry of byAddress.values()) {
      if (entry.summary.relationship.type !== 'parent') continue;
      const children = entry.summary.relationship.data?.childAddresses ?? [];
      for (const child of children) {
        parentByChild.set(child.toLowerCase(), entry.summary.vaultAddress);
      }
    }
    this.parentByChild = parentByChild;

    let registry = [...byAddress.values()];
    if (this.maxVaults !== undefined) {
      registry = registry.slice(0, this.maxVaults);
    }
    this.registry = registry;
    return registry;
  }

  private async loadAllDetails(registry: VaultStatsEntry[]): Promise<Map<string, VaultDetails>> {
    await mapPool(registry, this.concurrency, async (entry) => {
      await this.loadDetails(entry.summary.vaultAddress);
    });
    return this.detailsByAddress;
  }

  private async loadDetails(address: string): Promise<VaultDetails> {
    const cached = this.detailsByAddress.get(address);
    if (cached) return cached;

    const raw = await this.fetch(this.infoUrl, {
      method: 'POST',
      body: { type: 'vaultDetails', vaultAddress: address },
      bucket: this.bucket,
    });
    await this.onRaw?.(`vaultDetails/${address}`, raw);
    const detail = parseOrThrow(vaultDetailsSchema, raw, `hyperliquid vaultDetails ${address}`);
    this.detailsByAddress.set(address, detail);
    return detail;
  }

  private toDescriptor(entry: VaultStatsEntry): EntityDescriptor {
    const address = entry.summary.vaultAddress;
    const parent = this.parentByChild.get(address);
    const detail = this.detailsByAddress.get(address);
    const commission = detail
      ? decimalFromJsonNumber(detail.leaderCommission)
      : undefined;

    return {
      source: this.id,
      externalId: address,
      kind: 'vault',
      name: detail?.name ?? entry.summary.name,
      venue: 'hyperliquid',
      venueType: 'dex',
      marketType: 'perp',
      baseCurrency: 'USDC',
      inceptionDate: dateFromEpochMillis(entry.summary.createTimeMillis),
      parentExternalId: parent,
      status: (detail?.isClosed ?? entry.summary.isClosed) ? 'closed' : 'active',
      metadata: {
        leaderCommission: commission,
      },
    };
  }
}

function bucket(detail: VaultDetails, period: string) {
  const found = detail.portfolio.find(([name]) => name === period);
  return found?.[1];
}

function dayPointOnDate(
  detail: VaultDetails,
  date: Date,
): { accountValue: string; cumPnl: string } | undefined {
  const day = bucket(detail, 'day');
  const allTime = bucket(detail, 'allTime');
  if (!day) return undefined;

  const asOf = toIsoDate(date);
  const matching = [...day.accountValueHistory].reverse().find(([ts]) => {
    return toIsoDate(dateFromEpochMillis(ts)) === asOf;
  });
  if (!matching) return undefined;

  const [ts, accountValue] = matching;
  const dayPnl = day.pnlHistory.find(([pnlTs]) => pnlTs === ts)?.[1];
  const allTimePnl = allTime
    ? [...allTime.pnlHistory].reverse().find(([pnlTs]) => toIsoDate(dateFromEpochMillis(pnlTs)) === asOf)?.[1]
    : undefined;

  // allTime pnlHistory is cumulative since inception (trap 2). Prefer it
  // when a point lands on this date; otherwise keep the day-bucket value
  // so the daily row still has a number.
  const cumPnl = allTimePnl ?? dayPnl;
  if (cumPnl === undefined) return undefined;
  return { accountValue, cumPnl };
}

function normalizeDepositor(user: string): string {
  return /^0x[0-9a-fA-F]{40}$/.test(user) ? user.toLowerCase() : user;
}
