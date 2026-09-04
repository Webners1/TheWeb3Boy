import {
  fetchJson,
  parseDecimal,
  parseIsoDate,
  toIsoDate,
  TokenBucket,
} from '@vaultbench/shared';

import type { AdapterHooks, EntityDescriptor, RawSnapshot, Source } from '../types.js';
import { parseOrThrow } from '../parse.js';
import {
  enzymeTimeSeriesResponseSchema,
  enzymeVaultListResponseSchema,
  type EnzymeVaultListItem,
} from './schemas.js';

const DEFAULT_ENDPOINT = 'https://api.enzyme.finance';
const SERVICE = 'enzyme.enzyme.v1.EnzymeService';

/**
 * Production deployments only.
 *
 * `DEPLOYMENT_TESTNET` is deliberately absent. Testnet vaults trade fake money
 * and would otherwise land in the same rankings as real ones, where nothing
 * downstream could tell them apart.
 */
export const ENZYME_DEPLOYMENTS = [
  'DEPLOYMENT_ETHEREUM',
  'DEPLOYMENT_POLYGON',
  'DEPLOYMENT_ARBITRUM',
  'DEPLOYMENT_BASE',
] as const;
export type EnzymeDeployment = (typeof ENZYME_DEPLOYMENTS)[number];

/**
 * Stated explicitly even though `CURRENCY_UNSPECIFIED` already means USD.
 * Every figure in this repository is USD-denominated, and relying on a
 * vendor's unspecified-value default to stay USD is how a currency silently
 * changes under a benchmark comparison.
 */
const CURRENCY = 'CURRENCY_USD';

/** The coarsest resolution Enzyme offers, and the one we want. */
const RESOLUTION_DAILY = 'RESOLUTION_ONE_DAY';

/**
 * Floor for a backfill range when a vault reports no inception date. Enzyme
 * v2 (Phoenix) launched in 2019, so nothing predates this.
 */
const HISTORY_FLOOR = '2019-01-01';

export interface EnzymeSourceOptions extends AdapterHooks {
  endpoint?: string;
  apiKey?: string;
  deployments?: readonly string[];
  fetchJson?: typeof fetchJson;
  /** Overridable so a test does not have to wait on the bucket. */
  requestsPerSecond?: number;
  /** Injected so backfill ranges are deterministic under test. */
  now?: () => Date;
}

/**
 * Enzyme Protocol vault adapter.
 *
 * Enzyme is the one venue here that publishes a true per-share NAV *net of
 * fees* and retains dead vaults, which makes it the most trustworthy source in
 * the set — and the only one behind a key. The key is free and self-serve
 * (https://app.enzyme.finance/account/api-tokens), so this stays inside the
 * no-paid-APIs rule, but without one the adapter cannot run at all and says so
 * rather than returning an empty universe.
 *
 * Two properties of the venue are worth knowing before reading further:
 *
 * - **Money arrives as bare JSON numbers**, not decimal strings, so it has
 *   been through a binary float before we can touch it. The schema calls
 *   these fields `float` but the JSON gateway emits full doubles — a live
 *   `netShareValue` is `1688.2824302978102`, which no float32 can hold.
 *   Handling is in `./schemas.ts`: preserve the wire token exactly, adding no
 *   digits and dropping none.
 *
 * - **Enzyme tells you when its own price is wrong.** `price_is_valid` /
 *   `share_price_valid` go false when the vault's holdings could not be
 *   priced — a stale oracle, usually. The share value is still populated on
 *   those points, and still wrong. Every such point is dropped.
 */
export class EnzymeSource implements Source {
  readonly id = 'enzyme';
  private readonly endpoint: string;
  private readonly apiKey: string | undefined;
  private readonly deployments: readonly string[];
  private readonly fetch: typeof fetchJson;
  private readonly onRaw?: AdapterHooks['onRaw'];
  private readonly now: () => Date;
  /**
   * 2 req/s, conservatively.
   *
   * Unlike Chamber's 50-per-minute — which was measured, twice — Enzyme
   * publishes no quota and none could be measured without a token. This is a
   * guess, and it is labelled as one. The 429 handling in `fetchJson` is the
   * real safety net; if a run does hit a limit, measure it and replace this
   * number with the measurement rather than nudging it down.
   */
  private readonly bucket: TokenBucket;

  private vaults: Map<string, EnzymeVaultListItem[]> | null = null;

  constructor(options: EnzymeSourceOptions = {}) {
    this.endpoint = options.endpoint ?? process.env.ENZYME_API_URL ?? DEFAULT_ENDPOINT;
    this.apiKey = options.apiKey ?? process.env.ENZYME_API_KEY;
    this.deployments =
      options.deployments ?? parseDeployments(process.env.ENZYME_DEPLOYMENTS) ?? ENZYME_DEPLOYMENTS;
    this.fetch = options.fetchJson ?? fetchJson;
    this.onRaw = options.onRaw;
    this.now = options.now ?? (() => new Date());
    this.bucket = new TokenBucket(options.requestsPerSecond ?? 2, 2);
  }

  /** True when a key is configured. Lets ingest skip the source cleanly. */
  get configured(): boolean {
    return this.apiKey !== undefined && this.apiKey.length > 0;
  }

  async listEntities(): Promise<EntityDescriptor[]> {
    const byDeployment = await this.loadVaults();
    const descriptors: EntityDescriptor[] = [];

    for (const [deployment, vaults] of byDeployment) {
      for (const vault of vaults) {
        descriptors.push(toDescriptor(deployment, vault));
      }
    }

    return descriptors;
  }

  /**
   * One request per deployment, nothing per vault: `GetVaultList` already
   * carries the current share price.
   */
  async snapshot(date: Date): Promise<RawSnapshot[]> {
    const byDeployment = await this.loadVaults();
    const snapshots: RawSnapshot[] = [];

    for (const [deployment, vaults] of byDeployment) {
      for (const vault of vaults) {
        // Enzyme could not price this vault's holdings. The number below is
        // populated and wrong, so there is nothing to record.
        if (vault.sharePriceValid !== true) continue;
        if (vault.sharePrice === null || vault.sharePrice === undefined) continue;

        const valuePerUnit = parseDecimal(vault.sharePrice);
        // A vault with no shares issued has no per-share price to speak of.
        if (valuePerUnit.lte(0)) continue;

        snapshots.push({
          source: this.id,
          externalId: externalId(deployment, vault.address),
          asOf: date,
          // A true per-share NAV, net of fees, published by the venue.
          valuePerUnit,
          ...(vault.grossAssetValue === null || vault.grossAssetValue === undefined
            ? {}
            : { aumUsd: parseDecimal(vault.grossAssetValue) }),
          sampling: 'daily',
          navQuality: 'reported',
        });
      }
    }

    return snapshots;
  }

  /**
   * Daily per-share NAV for the vault's whole life.
   *
   * Genuinely daily, not downsampled: Enzyme serves an explicit
   * `RESOLUTION_ONE_DAY` over a requested range, so unlike Chamber's
   * two-day spacing or Hyperliquid's ~93 points this is a full-resolution
   * history.
   */
  async backfill(externalIdValue: string): Promise<RawSnapshot[]> {
    const { deployment, address } = parseExternalId(externalIdValue);
    const inception = await this.inceptionOf(deployment, address);

    const payload = await this.call(
      'GetVaultTimeSeries',
      {
        deployment,
        address,
        currency: CURRENCY,
        resolution: RESOLUTION_DAILY,
        range: {
          from: `${inception}T00:00:00Z`,
          to: `${toIsoDate(this.now())}T00:00:00Z`,
        },
      },
      `vaultTimeSeries/${externalIdValue}`,
    );

    const parsed = parseOrThrow(
      enzymeTimeSeriesResponseSchema,
      payload,
      `enzyme GetVaultTimeSeries ${externalIdValue}`,
    );

    /**
     * Keyed by UTC date, last write winning.
     *
     * `entity_snapshots` is unique on `(entity_id, as_of)`, so two points
     * landing on the same UTC day would abort the whole batch on insert. A
     * daily resolution should not produce two, but "should not" is not a
     * constraint, and the last reading of a day is the one we want anyway.
     */
    const byDate = new Map<string, RawSnapshot>();

    for (const point of parsed.items ?? []) {
      // Same rule as the daily snapshot: Enzyme's own invalid-price flag wins
      // over the number it published alongside it.
      if (point.priceIsValid !== true) continue;
      if (point.netShareValue === null || point.netShareValue === undefined) continue;

      const valuePerUnit = parseDecimal(point.netShareValue);
      if (valuePerUnit.lte(0)) continue;

      const asOfIso = toIsoDate(new Date(point.timestamp));
      byDate.set(asOfIso, {
        source: this.id,
        externalId: externalIdValue,
        asOf: parseIsoDate(asOfIso),
        valuePerUnit,
        ...(point.grossAssetValue === null || point.grossAssetValue === undefined
          ? {}
          : { aumUsd: parseDecimal(point.grossAssetValue) }),
        sampling: 'daily',
        navQuality: 'reported',
      });
    }

    return [...byDate.values()].sort((left, right) => left.asOf.getTime() - right.asOf.getTime());
  }

  private async inceptionOf(deployment: string, address: string): Promise<string> {
    const byDeployment = await this.loadVaults();
    const vault = byDeployment
      .get(deployment)
      ?.find((candidate) => candidate.address === address.toLowerCase());

    if (vault?.inception === null || vault?.inception === undefined) return HISTORY_FLOOR;
    return toIsoDate(new Date(vault.inception));
  }

  private async loadVaults(): Promise<Map<string, EnzymeVaultListItem[]>> {
    if (this.vaults) return this.vaults;

    const byDeployment = new Map<string, EnzymeVaultListItem[]>();

    for (const deployment of this.deployments) {
      const payload = await this.call(
        'GetVaultList',
        { deployment, currency: CURRENCY },
        `vaultList/${deployment.toLowerCase()}`,
      );
      const parsed = parseOrThrow(
        enzymeVaultListResponseSchema,
        payload,
        `enzyme GetVaultList ${deployment}`,
      );

      // Same address can be deployed on more than one chain, but not twice
      // within one deployment.
      const seen = new Set<string>();
      const vaults: EnzymeVaultListItem[] = [];
      for (const vault of parsed.vaults ?? []) {
        if (seen.has(vault.address)) continue;
        seen.add(vault.address);
        vaults.push(vault);
      }

      byDeployment.set(deployment, vaults);
    }

    this.vaults = byDeployment;
    return byDeployment;
  }

  /**
   * One Connect-over-HTTP call. Connect exposes each gRPC method as a plain
   * POST to `/{service}/{Method}` with a JSON body, so no gRPC client is
   * needed — which also keeps the "no new wrapper layers" rule intact.
   */
  private async call(method: string, body: unknown, rawName: string): Promise<unknown> {
    if (!this.configured) {
      throw new Error(
        'ENZYME_API_KEY is not set. Enzyme requires a free self-serve token from ' +
          'https://app.enzyme.finance/account/api-tokens. Refusing to run rather than ' +
          'reporting an empty vault universe as a successful ingest.',
      );
    }

    const payload = await this.fetch(`${this.endpoint}/${SERVICE}/${method}`, {
      method: 'POST',
      body,
      headers: {
        authorization: `Bearer ${this.apiKey ?? ''}`,
        // Connect refuses a request without this header.
        'connect-protocol-version': '1',
      },
      bucket: this.bucket,
      timeoutMs: 120_000,
    });

    await this.onRaw?.(rawName, payload);
    return payload;
  }
}

/**
 * `deployment:address`, lowercased.
 *
 * The same vault address can exist on Ethereum and Polygon, so the address
 * alone is not a unique key across the Enzyme universe — the same reason
 * Chamber keys on `chain:address`.
 */
export function externalId(deployment: string, address: string): string {
  return `${shortDeployment(deployment)}:${address.toLowerCase()}`;
}

export function parseExternalId(value: string): { deployment: string; address: string } {
  const separator = value.indexOf(':');
  if (separator === -1) {
    throw new Error(`enzyme external id must be "deployment:address": ${value}`);
  }
  const short = value.slice(0, separator);
  const deployment = `DEPLOYMENT_${short.toUpperCase()}`;
  if (!ENZYME_DEPLOYMENTS.includes(deployment as EnzymeDeployment)) {
    // Not a silent fallback: an unknown deployment would otherwise be sent to
    // the API, which reads an unrecognised enum as UNSPECIFIED and answers
    // with *Ethereum's* vaults. That would file another chain's history under
    // this one.
    throw new Error(`unknown enzyme deployment in external id: ${value}`);
  }
  return { deployment, address: value.slice(separator + 1) };
}

function shortDeployment(deployment: string): string {
  return deployment.replace(/^DEPLOYMENT_/, '').toLowerCase();
}

function toDescriptor(deployment: string, vault: EnzymeVaultListItem): EntityDescriptor {
  const chain = shortDeployment(deployment);

  return {
    source: 'enzyme',
    externalId: externalId(deployment, vault.address),
    kind: 'vault',
    // GetVaultList carries no name. Filled in by the per-vault GetVault call
    // during metadata refresh; the address is a truthful placeholder in the
    // meantime, where a guessed name would not be.
    name: vault.address,
    venue: `enzyme:${chain}`,
    venueType: 'dex',
    // Enzyme vaults hold spot assets and can take external positions.
    marketType: 'mixed',
    baseCurrency: 'USD',
    ...(vault.inception === null || vault.inception === undefined
      ? {}
      : { inceptionDate: parseIsoDate(toIsoDate(new Date(vault.inception))) }),
    /**
     * Always active.
     *
     * `GetVaultList` has no status field, and a vault with zero assets is not
     * necessarily closed — it may simply be empty between mandates. Inferring
     * `closed` from a zero balance is the same mistake as a TVL floor at
     * discovery: it invents a death. Fee terms need `GetVaultConfiguration`
     * per vault, so they stay absent here rather than being guessed at.
     */
    status: 'active',
    metadata: {},
  };
}

function parseDeployments(raw: string | undefined): readonly string[] | undefined {
  if (!raw) return undefined;
  const deployments = raw
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => value.length > 0)
    .map((value) => (value.startsWith('DEPLOYMENT_') ? value : `DEPLOYMENT_${value}`));
  return deployments.length > 0 ? deployments : undefined;
}
