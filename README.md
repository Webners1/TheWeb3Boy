# VaultBench

Daily archive of crypto vault and copy-trading state, so performance can later
be compared against BTC / ETH / SOL buy-and-hold. This repository is the
ingestion and storage layer. It does not compute returns.

The product is the normalisation layer and the append-only archive. Raw
payloads are gzipped before parse; derived metrics (later) are disposable.

## Setup

Node 22 LTS, pnpm 10.

```bash
pnpm install
cp .env.example .env   # then set DATABASE_URL
pnpm --filter @vaultbench/db exec drizzle-kit migrate
pnpm check             # harness + typecheck + tests
```

Apply the SQL in `packages/db/migrations/` to a Postgres database (Supabase
free tier is the target).

### Environment

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Postgres. Required. Never hardcoded. |
| `ARCHIVE_ROOT` | Local gzip archive root. Default `./var/archive`. |
| `S3_BUCKET` + `S3_ENDPOINT` + keys | Cloudflare R2 / Supabase Storage instead of local files. |
| `OKX_API_BASE` | Default `https://www.okx.com`. |
| `HYPERLIQUID_MAX_VAULTS` | **Smoke tests only.** Do not set in production. |

## Jobs

```bash
pnpm ingest -- --source=all
pnpm ingest -- --source=hyperliquid --date=2026-09-04
pnpm backfill -- --source=hyperliquid
pnpm backfill -- --source=defillama
```

`--source=all` runs Hyperliquid, OKX, then DefiLlama prices.

GitHub Actions: `.github/workflows/snapshot.yml` (daily 00:17 UTC +
`workflow_dispatch`). Put `DATABASE_URL` in repository secrets. The workflow
fails on a non-zero ingest exit.

A first Hyperliquid run walks every vault through `vaultDetails` at ~10 req/s
(thousands of vaults, on the order of 15–20 minutes). That is expected. The
followers cross-section cannot be reconstructed later.

## Traps (also in `docs/traps.md`)

1. **Downsampling.** Hyperliquid `allTime` is ~93 points over the vault's life.
   Backfill writes `sampling='downsampled'`. Only a same-day `day` bucket point
   is `sampling='daily'`. A downsampled row never overwrites a daily row.
2. **Cumulative PnL.** `allTime.pnlHistory` is since inception. Do not
   difference it.
3. **Account value is not NAV.** `accountValueHistory` moves with deposits.
   `value_per_unit` stays null. Deriving per-share value is the next task.
4. **Empty array is valid HTTP 200.** If `rows_written` is 0, or outside
   50–150% of yesterday's successful `rows_written`, the run aborts, the
   transaction rolls back, and the process exits non-zero.
5. **`vaultSummaries` is a new-vault feed**, not the universe. Discovery uses
   `https://stats-data.hyperliquid.xyz/Mainnet/vaults`.
6. **Parent/child vaults.** Children do not name their parent. The parent
   record lists `childAddresses`. Never sum TVL across a parent and its
   children.
7. **OKX survivorship.** `public-lead-traders` is currently-qualifying leads
   only. A lead that vanishes is marked `delisted`, never deleted. Spot and
   perp populations are not merged (`spot:CODE` vs `swap:CODE`).
8. **Decimals.** Source strings go through `decimal.js` into Postgres
   `numeric`. `parseFloat` on a money value is a defect. DefiLlama prices
   arrive as JSON numbers; they are boxed into Decimal immediately.
9. **OKX rate limits.** Public copy-trading endpoints are **5 requests / 2
   seconds / IP**. The client throttles to 2 req/s.
10. **OKX redistribution.** TODO: review OKX terms before selling a dataset
    built on this feed.

## Layout

```
packages/db          Drizzle schema, migrations, client
packages/sources     Adapters. Zero database imports.
packages/ingest      Daily job — the only writer
packages/backfill    Thin CLI around ingest's historical writer
packages/shared      Zod, decimals, logger, archive, HTTP
```

## Design decisions that later phases should not fight

- `value_per_unit` is nullable. Hyperliquid and OKX cannot fill it yet.
  Metrics must treat null as "no NAV" and refuse to rank those rows as TWR.
- Same-day metadata restatement updates the open SCD-2 row in place.
  A change on a later `as_of` closes yesterday and opens a new row.
- Ingest `rows_written` is the universe size (entities listed), not snapshot
  count, because the empty-array failure mode is "the registry came back
  empty".
- Raw archive keys are `raw/{source}/{YYYY-MM-DD}/{name}.json.gz`. Re-runs
  do not overwrite an existing object (`wx` / S3 `If-None-Match: *`).
