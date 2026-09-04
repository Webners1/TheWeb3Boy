import { describe, expect, it } from 'vitest';

import { EnzymeSource, externalId, parseExternalId } from './adapter.js';
import { enzymeTimeSeriesResponseSchema, enzymeVaultListResponseSchema } from './schemas.js';

const VAULT = '0x1b83ba4527c837d462d5b78d65a097dabae5ea89';
const OTHER = '0x2c94cb5638d948e573e6c89e76b1a8ebcbf6fb9a';

/**
 * Responses are shaped from Enzyme's published protobuf definitions
 * (`buf export buf.build/avantgardefinance/enzyme`), which is why the numbers
 * below are plain JSON numbers and the timestamps are RFC 3339 strings.
 */
function vaultListResponse(vaults: unknown[]): unknown {
  return { numberOfVaults: vaults.length, vaults };
}

function stubFetch(routes: Record<string, unknown>) {
  const calls: Array<{ url: string; body: unknown; headers: Record<string, string> }> = [];
  const fetchJson = async (url: string, options: Record<string, unknown> = {}) => {
    calls.push({
      url,
      body: options.body,
      headers: (options.headers ?? {}) as Record<string, string>,
    });
    const method = url.split('/').pop() ?? '';
    if (!(method in routes)) throw new Error(`unexpected enzyme method: ${method}`);
    return routes[method];
  };
  return { fetchJson: fetchJson as never, calls };
}

function source(routes: Record<string, unknown>, options: Record<string, unknown> = {}) {
  const stub = stubFetch(routes);
  const instance = new EnzymeSource({
    apiKey: 'k',
    deployments: ['DEPLOYMENT_ETHEREUM'],
    fetchJson: stub.fetchJson,
    requestsPerSecond: 1000,
    now: () => new Date('2026-03-01T00:00:00Z'),
    ...options,
  });
  return { instance, calls: stub.calls };
}

describe('EnzymeSource', () => {
  it('refuses to run without a key instead of reporting an empty universe', async () => {
    // The failure mode this guards against is quiet: no key, no vaults, an
    // ingest run that looks like a success and silently marks the whole
    // Enzyme universe as having gone away.
    const { instance } = source({}, { apiKey: undefined });
    await expect(instance.listEntities()).rejects.toThrow(/ENZYME_API_KEY is not set/);
  });

  it('sends the Connect headers the API requires', async () => {
    const { instance, calls } = source({
      GetVaultList: vaultListResponse([]),
    });
    await instance.listEntities();

    expect(calls[0]?.url).toBe(
      'https://api.enzyme.finance/enzyme.enzyme.v1.EnzymeService/GetVaultList',
    );
    expect(calls[0]?.headers.authorization).toBe('Bearer k');
    expect(calls[0]?.headers['connect-protocol-version']).toBe('1');
    // USD is stated, never left to the vendor's unspecified-value default.
    expect(calls[0]?.body).toMatchObject({ currency: 'CURRENCY_USD' });
  });

  it('reads a share price at the source precision, not the double that JSON gives', async () => {
    // 1.05 as a float32 widens to 1.0499999523162842 as a double. Storing
    // that would assert sixteen significant digits about a seven-digit
    // source, and the tail would render as precision.
    const { instance } = source({
      GetVaultList: vaultListResponse([
        {
          address: VAULT,
          inception: '2024-01-01T00:00:00Z',
          sharePrice: Math.fround(1.05),
          sharePriceValid: true,
          grossAssetValue: Math.fround(1234567.5),
        },
      ]),
    });

    const snapshots = await instance.snapshot(new Date('2026-03-01T00:00:00Z'));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.valuePerUnit?.toFixed()).toBe('1.05');
    expect(snapshots[0]?.aumUsd?.toFixed()).toBe('1234567.5');
    // A genuine per-share NAV, net of fees — so it is rankable.
    expect(snapshots[0]?.navQuality).toBe('reported');
    expect(snapshots[0]?.sampling).toBe('daily');
  });

  it("drops a price Enzyme itself flags as invalid", async () => {
    // sharePriceValid false means the vault's holdings could not be priced.
    // The number is still populated, and still wrong.
    const { instance } = source({
      GetVaultList: vaultListResponse([
        { address: VAULT, sharePrice: 1.05, sharePriceValid: false },
        { address: OTHER, sharePrice: 2.5, sharePriceValid: true },
      ]),
    });

    const snapshots = await instance.snapshot(new Date('2026-03-01T00:00:00Z'));
    expect(snapshots.map((row) => row.externalId)).toEqual([`ethereum:${OTHER}`]);
  });

  it('treats an omitted validity flag as invalid, not as valid', async () => {
    // Connect omits zero values, so `false` arrives as an absent field. A
    // schema that defaulted this to true would wave through exactly the
    // prices the flag exists to warn about.
    const { instance } = source({
      GetVaultList: vaultListResponse([{ address: VAULT, sharePrice: 1.05 }]),
    });
    expect(await instance.snapshot(new Date('2026-03-01T00:00:00Z'))).toEqual([]);
  });

  it('skips a vault with no shares issued rather than indexing from zero', async () => {
    const { instance } = source({
      GetVaultList: vaultListResponse([
        { address: VAULT, sharePrice: 0, sharePriceValid: true },
      ]),
    });
    expect(await instance.snapshot(new Date('2026-03-01T00:00:00Z'))).toEqual([]);
  });

  it('accepts snake_case field names as well as camelCase', async () => {
    // Both are valid protojson for the same field; which one a Connect server
    // emits depends on its UseProtoNames setting, which we cannot observe.
    const { instance } = source({
      GetVaultList: {
        number_of_vaults: 1,
        vaults: [
          {
            address: VAULT,
            share_price: Math.fround(3.25),
            share_price_valid: true,
            gross_asset_value: Math.fround(500),
          },
        ],
      },
    });

    const snapshots = await instance.snapshot(new Date('2026-03-01T00:00:00Z'));
    expect(snapshots[0]?.valuePerUnit?.toFixed()).toBe('3.25');
    expect(snapshots[0]?.aumUsd?.toFixed()).toBe('500');
  });

  describe('backfill', () => {
    const routes = {
      GetVaultList: vaultListResponse([
        {
          address: VAULT,
          inception: '2025-06-15T12:34:56Z',
          sharePrice: 1.1,
          sharePriceValid: true,
        },
      ]),
      GetVaultTimeSeries: {
        items: [
          {
            timestamp: '2025-06-15T00:00:00Z',
            netShareValue: Math.fround(1),
            grossAssetValue: Math.fround(1000),
            priceIsValid: true,
          },
          {
            timestamp: '2025-06-16T00:00:00Z',
            netShareValue: Math.fround(1.02),
            priceIsValid: true,
          },
          // Enzyme could not price the holdings here.
          {
            timestamp: '2025-06-17T00:00:00Z',
            netShareValue: Math.fround(99),
            priceIsValid: false,
          },
          {
            timestamp: '2025-06-18T00:00:00Z',
            netShareValue: Math.fround(1.04),
            priceIsValid: true,
          },
        ],
      },
    };

    it('asks for a daily series from inception to today', async () => {
      const { instance, calls } = source(routes);
      await instance.backfill(`ethereum:${VAULT}`);

      const request = calls.find((call) => call.url.endsWith('GetVaultTimeSeries'));
      expect(request?.body).toMatchObject({
        deployment: 'DEPLOYMENT_ETHEREUM',
        address: VAULT,
        currency: 'CURRENCY_USD',
        resolution: 'RESOLUTION_ONE_DAY',
        range: { from: '2025-06-15T00:00:00Z', to: '2026-03-01T00:00:00Z' },
      });
    });

    it('returns a genuinely daily series and drops the invalid point', async () => {
      const { instance } = source(routes);
      const snapshots = await instance.backfill(`ethereum:${VAULT}`);

      expect(snapshots.map((row) => row.asOf.toISOString().slice(0, 10))).toEqual([
        '2025-06-15',
        '2025-06-16',
        '2025-06-18',
      ]);
      expect(snapshots.map((row) => row.valuePerUnit?.toFixed())).toEqual(['1', '1.02', '1.04']);
      // Not downsampled, unlike Chamber's two-day spacing: Enzyme serves an
      // explicit daily resolution.
      expect(snapshots.every((row) => row.sampling === 'daily')).toBe(true);
    });

    it('collapses two points on one UTC day instead of colliding on insert', async () => {
      // entity_snapshots is unique on (entity_id, as_of), so a duplicate day
      // would abort the whole batch. The later reading wins.
      const { instance } = source({
        ...routes,
        GetVaultTimeSeries: {
          items: [
            { timestamp: '2025-06-16T00:00:00Z', netShareValue: 1, priceIsValid: true },
            { timestamp: '2025-06-16T23:00:00Z', netShareValue: Math.fround(1.5), priceIsValid: true },
          ],
        },
      });

      const snapshots = await instance.backfill(`ethereum:${VAULT}`);
      expect(snapshots).toHaveLength(1);
      expect(snapshots[0]?.valuePerUnit?.toFixed()).toBe('1.5');
    });

    it('falls back to the protocol history floor when inception is unknown', async () => {
      const { instance, calls } = source({
        ...routes,
        GetVaultList: vaultListResponse([
          { address: VAULT, sharePrice: 1, sharePriceValid: true },
        ]),
      });
      await instance.backfill(`ethereum:${VAULT}`);

      const request = calls.find((call) => call.url.endsWith('GetVaultTimeSeries'));
      expect(request?.body).toMatchObject({ range: { from: '2019-01-01T00:00:00Z' } });
    });
  });

  describe('entities', () => {
    it('keys on deployment and address, since one address can span chains', async () => {
      const { instance } = source({
        GetVaultList: vaultListResponse([
          { address: VAULT, inception: '2024-02-29T18:00:00Z' },
        ]),
      });

      const entities = await instance.listEntities();
      expect(entities[0]).toMatchObject({
        source: 'enzyme',
        externalId: `ethereum:${VAULT}`,
        kind: 'vault',
        venue: 'enzyme:ethereum',
        venueType: 'dex',
        baseCurrency: 'USD',
        status: 'active',
      });
      expect(entities[0]?.inceptionDate?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    });

    it('never infers a closure from an empty vault', async () => {
      // A vault with no assets may simply be empty between mandates.
      // Inferring `closed` would invent a death, the same way a TVL floor at
      // discovery does.
      const { instance } = source({
        GetVaultList: vaultListResponse([
          { address: VAULT, grossAssetValue: 0, numberOfShares: 0 },
        ]),
      });
      expect((await instance.listEntities())[0]?.status).toBe('active');
    });

    it('leaves fee terms absent rather than guessing them', async () => {
      // Fees need a per-vault GetVaultConfiguration call. An assumed 20/2
      // would flow straight into a net-of-fees return.
      const { instance } = source({
        GetVaultList: vaultListResponse([{ address: VAULT }]),
      });
      expect((await instance.listEntities())[0]?.metadata).toEqual({});
    });
  });

  describe('external ids', () => {
    it('round-trips', () => {
      expect(parseExternalId(externalId('DEPLOYMENT_POLYGON', VAULT.toUpperCase()))).toEqual({
        deployment: 'DEPLOYMENT_POLYGON',
        address: VAULT,
      });
    });

    it('rejects an unknown deployment instead of silently getting Ethereum', () => {
      // The API reads an unrecognised enum as UNSPECIFIED and answers with
      // Ethereum's vaults, which would file another chain's history here.
      expect(() => parseExternalId(`solana:${VAULT}`)).toThrow(/unknown enzyme deployment/);
      expect(() => parseExternalId(VAULT)).toThrow(/must be "deployment:address"/);
    });
  });

  describe('schema guards', () => {
    it('rejects a NaN share price rather than reading it as zero', () => {
      // JSON has no NaN literal, but Connect can emit the string "NaN" for a
      // float. Coercing that to 0 would turn "we don't know" into "it is
      // worthless" and compound through the return series.
      const parsed = enzymeVaultListResponseSchema.safeParse({
        vaults: [{ address: VAULT, sharePrice: 'NaN', sharePriceValid: true }],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects a timestamp that is not a real instant', () => {
      const parsed = enzymeTimeSeriesResponseSchema.safeParse({
        items: [{ timestamp: 'yesterday', netShareValue: 1, priceIsValid: true }],
      });
      expect(parsed.success).toBe(false);
    });

    it('rejects a malformed address', () => {
      const parsed = enzymeVaultListResponseSchema.safeParse({
        vaults: [{ address: '0xnope' }],
      });
      expect(parsed.success).toBe(false);
    });
  });
});
