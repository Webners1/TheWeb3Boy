# Build prompt 01 — base infrastructure

> Paste this as the opening prompt for a coding agent (Claude Code or similar).
> It builds ingestion and storage only. Metrics, benchmarking, API, web UI and
> the MCP server are deliberately out of scope — a second prompt covers those.

---

## Role and objective

You are building the data foundation for **VaultBench**, a system that will later
compare crypto vault and copy-trading performance against a BTC/ETH/SOL
buy-and-hold benchmark.

This task builds **only the ingestion and storage layer**. Do not build metrics,
comparison logic, an HTTP API, a web UI, or an MCP server. If you find yourself
writing a return calculation, stop — that is the next task.

The single deliverable that matters: **a daily job that reliably captures vault
and lead-trader state into Postgres, and a one-shot backfill that loads whatever
history the sources expose.** Every day this job does not run is data that cannot
be recovered later.

---

## Hard constraints

1. **No paid APIs.** Every source used here is free and either unauthenticated or
   self-serve-keyed. Do not introduce a dependency requiring payment.
2. **No floating point anywhere in the data path.** Sources return decimal
   strings. Parse with `decimal.js`, store as Postgres `numeric`. A single
   `parseFloat` on a money value is a defect.
3. **Raw is append-only.** Snapshot rows are inserted or idempotently re-upserted
   for the same key. They are never mutated to "correct" them.
4. **Validate every external response with Zod before it touches the database.**
   A schema failure aborts the run; it never writes partial data.
5. **Archive every raw payload**, gzipped, before parsing.
6. **TypeScript strict mode.** No `any`. No non-null assertions on parsed
   external data.

---

## Stack (use exactly this)

- Node 22 LTS, TypeScript 5.x, `strict: true`
- pnpm workspaces + Turborepo
- Postgres via **Drizzle ORM** + `drizzle-kit` (Supabase free tier as target)
- **Zod** for all boundary validation
- **decimal.js** for numeric parsing
- `@nktkas/hyperliquid` for Hyperliquid typed access where convenient; plain
  `fetch` is acceptable for the endpoints that SDK does not cover
- `vitest` for tests
- GitHub Actions for scheduling
- Cloudflare R2 or Supabase Storage for raw payload archive (S3-compatible client)

Do not add: pandas/Python, ClickHouse, a message queue, an ORM other than
Drizzle, GraphQL, or any real-time/WebSocket layer.

---

## Repository structure to create

```
vaultbench/
├─ package.json                 pnpm workspace root
├─ turbo.json
├─ tsconfig.base.json
├─ .env.example
├─ packages/
│  ├─ db/          Drizzle schema, migrations, client
│  ├─ sources/     Source interface + one adapter per venue
│  ├─ ingest/      daily snapshot job
│  ├─ backfill/    one-shot historical loaders
│  └─ shared/      Zod primitives, decimal helpers, logger, storage client
└─ .github/workflows/snapshot.yml
```

`packages/sources` must have **zero database imports**. Adapters return plain
normalised objects; `ingest` is the only package that writes.

---

## Database schema

Implement in `packages/db/src/schema.ts` with Drizzle, and generate migrations.

```sql
entities(
  id                uuid primary key default gen_random_uuid(),
  source            text not null,        -- 'hyperliquid' | 'okx' | 'defillama'
  external_id       text not null,
  kind              text not null,        -- 'vault' | 'lead_trader'
  name              text not null,
  venue             text not null,
  venue_type        text not null,        -- 'cex' | 'dex'
  market_type       text not null,        -- 'spot' | 'perp' | 'mixed'
  strategy_category text,                 -- nullable; hand-tagged later
  base_currency     text not null,
  inception_date    date,
  parent_entity_id  uuid references entities(id),
  status            text not null,        -- 'active' | 'closed' | 'delisted'
  first_seen_at     timestamptz not null,
  last_seen_at      timestamptz not null,
  unique (source, external_id)
)

entity_snapshots(
  entity_id      uuid not null references entities(id),
  as_of          date not null,
  value_per_unit numeric(38,18),          -- nullable at this stage
  account_value  numeric(28,8),
  cum_pnl        numeric(28,8),
  aum_usd        numeric(20,2),
  sampling       text not null,           -- 'daily' | 'downsampled'
  nav_quality    text not null,           -- 'reported' | 'derived' | 'raw'
  fetched_at     timestamptz not null,
  raw_ref        text,
  primary key (entity_id, as_of)
)

entity_flows(
  entity_id    uuid not null references entities(id),
  as_of        date not null,
  net_flow_usd numeric(28,8),
  primary key (entity_id, as_of)
)

depositors(
  entity_id     uuid not null references entities(id),
  as_of         date not null,
  depositor     text not null,
  equity        numeric(28,8),
  pnl           numeric(28,8),
  all_time_pnl  numeric(28,8),
  days_following integer,
  entry_time    timestamptz,
  lockup_until  timestamptz,
  primary key (entity_id, as_of, depositor)
)

benchmark_prices(
  symbol    text not null,                -- 'BTC' | 'ETH' | 'SOL'
  as_of     date not null,
  close_usd numeric(20,8) not null,
  source    text not null default 'defillama',
  primary key (symbol, as_of)
)

entity_metadata_history(                  -- SCD type 2
  entity_id         uuid not null references entities(id),
  valid_from        date not null,
  valid_to          date,                 -- null = current
  name              text,
  strategy_category text,
  fee_profit_share  numeric(6,4),
  fee_management    numeric(6,4),
  leader_commission numeric(6,4),
  status            text,
  primary key (entity_id, valid_from)
)

ingest_runs(
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  started_at    timestamptz not null,
  finished_at   timestamptz,
  status        text not null,            -- 'running'|'ok'|'failed'|'aborted'
  rows_written  integer,
  rows_expected integer,
  error         text
)

metric_definitions(
  key text primary key, label text, description text,
  unit text, direction text, caveats text
)
```

Indexes: BRIN on `entity_snapshots(as_of)`; btree on
`depositors(entity_id, as_of)`; btree on `entities(source, status)`.

Seed `metric_definitions` with an empty-but-valid table; the next task populates it.

---

## The Source interface

`packages/sources/src/types.ts`:

```ts
export interface EntityDescriptor {
  source: string;
  externalId: string;
  kind: 'vault' | 'lead_trader';
  name: string;
  venue: string;
  venueType: 'cex' | 'dex';
  marketType: 'spot' | 'perp' | 'mixed';
  baseCurrency: string;
  inceptionDate?: Date;
  parentExternalId?: string;
  status: 'active' | 'closed' | 'delisted';
  metadata: {
    feeProfitShare?: Decimal;
    feeManagement?: Decimal;
    leaderCommission?: Decimal;
  };
}

export interface RawSnapshot {
  source: string;
  externalId: string;
  asOf: Date;
  valuePerUnit?: Decimal;
  accountValue?: Decimal;
  cumPnl?: Decimal;
  aumUsd?: Decimal;
  sampling: 'daily' | 'downsampled';
  navQuality: 'reported' | 'derived' | 'raw';
}

export interface Source {
  id: string;
  listEntities(): Promise<EntityDescriptor[]>;
  snapshot(date: Date): Promise<RawSnapshot[]>;
  backfill?(externalId: string): Promise<RawSnapshot[]>;
  listDepositors?(externalId: string): Promise<DepositorRecord[]>;
}
```

Implement three adapters in this order: `hyperliquid`, `defillama`, `okx`.

---

## Adapter 1 — Hyperliquid

Base: `POST https://api.hyperliquid.xyz/info`, JSON body, no auth.
**Rate limit: 1200 request weight per minute per IP.** Throttle client-side to
~10 requests/second with a token bucket. Retry with exponential backoff on 429.

### Entity discovery — use the stats endpoint, not vaultSummaries

```
GET https://stats-data.hyperliquid.xyz/Mainnet/vaults
```

Plain static JSON, hourly snapshots of **all** vaults. This is the registry.

> **Critical:** do NOT use `{"type":"vaultSummaries"}` for discovery. Hyperliquid's
> docs state it returns vaults **less than 2 hours old** — it is a new-vault feed.
> You may call it additionally to catch newly created vaults between stats
> refreshes, but it is not the source of truth for the universe.

### Per-vault detail

```json
POST https://api.hyperliquid.xyz/info
{"type":"vaultDetails","vaultAddress":"0x<lowercase hex>"}
```

Response fields you must handle:

```
name, vaultAddress, leader, description
portfolio: [[period, { accountValueHistory: [[tsMillis, "value"], ...],
                       pnlHistory:          [[tsMillis, "value"], ...],
                       vlm: "..." }], ...]
  periods: "day"|"week"|"month"|"allTime"|"perpDay"|"perpWeek"|"perpMonth"|"perpAllTime"
apr (number), leaderFraction (number), leaderCommission (number)
followers: [{ user, vaultEquity, pnl, allTimePnl,
              daysFollowing, vaultEntryTime, lockupUntil }]
maxDistributable (number), maxWithdrawable (number)
relationship: { type: "normal" | ... }
```

### Hyperliquid-specific requirements

- **Decimal strings.** `accountValueHistory` / `pnlHistory` values, `vlm`, and all
  follower `vaultEquity` / `pnl` / `allTimePnl` are strings. `apr`,
  `leaderFraction`, `leaderCommission`, `maxDistributable`, `maxWithdrawable` are
  JSON numbers. Parse accordingly, store as `numeric`.
- **Timestamps are milliseconds.**
- **Addresses lowercase 0x hex.**
- **`pnlHistory` on the `allTime` bucket is CUMULATIVE since inception**, not
  per-period. Do not difference it as if it were periodic.
- **`accountValueHistory` is flow-contaminated** — it moves with deposits and
  withdrawals and is NOT a return series. Store it as `account_value` and leave
  `value_per_unit` null. Deriving per-share value is the next task's job.
- **Downsampling.** The `allTime` bucket returns a fixed downsampled series of
  roughly 93 points across the vault's entire life. Any snapshot derived from
  `allTime` must be written with `sampling='downsampled'`. Only points sourced
  from a same-day `day` bucket read may be written `sampling='daily'`.
- **Parent/child vaults.** `relationship.type` distinguishes standalone
  (`"normal"`) from parent/child. Populate `parent_entity_id`. Never sum TVL
  across a parent and its children.
- **Followers.** Write the full array to `depositors` on every daily run. This
  cross-section decays as depositors exit and cannot be reconstructed later.

---

## Adapter 2 — DefiLlama (benchmark prices)

Free, no authentication, no rate limit for normal traffic.

```
https://coins.llama.fi   prices, current and historical
```

Fetch daily closes for BTC, ETH and SOL into `benchmark_prices`. Support a
historical range fetch for backfill and a single-day fetch for the daily run.

This adapter does not produce entities — it only populates `benchmark_prices`.
Model it as a separate `PriceSource` interface rather than bending `Source`.

---

## Adapter 3 — OKX public copytrading

Base `https://www.okx.com`, **no authentication required** on these:

```
GET /api/v5/copytrading/public-lead-traders          rankings (discovery)
GET /api/v5/copytrading/public-stats                 per-trader stats
GET /api/v5/copytrading/public-pnl                   daily PnL
GET /api/v5/copytrading/public-weekly-pnl            weekly PnL
GET /api/v5/copytrading/public-current-subpositions  open positions
GET /api/v5/copytrading/public-subpositions-history  position history
GET /api/v5/copytrading/public-copy-traders          copiers for a lead
GET /api/v5/copytrading/public-config                platform config
```

Requirements:

- Support **both spot and perp** lead traders; they are distinct populations.
  Set `market_type` accordingly. Do not merge them.
- OKX reports ROI, not NAV per share. Write snapshots with
  `nav_quality='reported'` and leave `value_per_unit` null.
- **Survivorship.** `public-lead-traders` returns *currently qualifying* leads
  only. Any entity present yesterday and absent today must be marked
  `status='delisted'` — never deleted, never skipped. This delisting record is
  the single most valuable thing this adapter produces.
- Before merging, confirm and record OKX's documented rate limits in a code
  comment. Log a TODO noting that redistribution terms need review.

---

## The daily ingest job

`packages/ingest/src/run.ts`, invoked as `pnpm ingest --source=all --date=YYYY-MM-DD`.

Per source, in order:

1. Insert an `ingest_runs` row with `status='running'`.
2. Fetch the raw payload. Gzip and upload to object storage under
   `raw/{source}/{YYYY-MM-DD}/{name}.json.gz`. Keep the key as `raw_ref`.
3. Parse through Zod. **On schema failure: abort the run**, set `status='failed'`
   with the error, write nothing.
4. Compute `rows_expected` as the previous successful run's `rows_written`.
   If `rows_written` falls outside 50–150% of `rows_expected`, set
   `status='aborted'`, roll back the transaction, and exit non-zero.
   **An HTTP 200 with an empty array is a valid response from these sources and
   is the failure mode that silently destroys the dataset.** This check is the
   defence; do not skip it.
5. Upsert entities on `(source, external_id)`. Update `last_seen_at`.
   Mark absent entities `delisted`.
6. Insert or idempotently upsert `entity_snapshots` on `(entity_id, as_of)`.
7. Upsert `depositors` where the adapter supplies them.
8. Diff entity metadata against the current open row in
   `entity_metadata_history`. If any tracked field changed, close the open row
   (`valid_to = yesterday`) and insert a new one. This drift capture is
   forward-only and irreplaceable.
9. Finalise `ingest_runs` with `status='ok'` and counts.

The whole per-source write must be one transaction.

---

## The backfill job

`packages/backfill/src/run.ts`, `pnpm backfill --source=<id>`.

- Hyperliquid: for every discovered vault, pull `vaultDetails` and write the
  `allTime` portfolio series as snapshots with `sampling='downsampled'`.
- DefiLlama: full historical daily closes for BTC/ETH/SOL.
- OKX: paginate `public-pnl` / `public-subpositions-history` as far back as the
  API allows. Record the earliest date reached per entity in the run log.

Backfill must be safely re-runnable and must never overwrite a row written with
`sampling='daily'` with a `downsampled` one. Encode that as an explicit guard,
not a convention.

---

## GitHub Actions

`.github/workflows/snapshot.yml`: daily cron, runs `pnpm ingest --source=all`,
fails loudly on non-zero exit. Secrets via repository secrets; nothing hardcoded.
Add a `workflow_dispatch` trigger for manual re-runs with a date input.

---

## Tests (vitest)

- Zod schemas against captured real fixtures for every endpoint. Commit the
  fixtures.
- Decimal parsing: assert no precision loss on a value like
  `"329265410.90790099"`.
- The empty-array guard: assert the run aborts and writes nothing.
- Idempotency: running the same date twice produces identical table state.
- Backfill guard: a `downsampled` row must not overwrite a `daily` row.
- Metadata drift: a changed fee closes the old SCD row and opens a new one.

---

## Definition of done

- `pnpm ingest --source=all` completes against live APIs and writes real rows.
- `pnpm backfill --source=hyperliquid` and `--source=defillama` complete.
- Running ingest twice for the same date changes nothing.
- A deliberately corrupted fixture aborts the run and writes nothing.
- The GitHub Action runs green on a manual dispatch.
- `README.md` documents setup, environment variables, and every trap listed above
  so the next person does not rediscover them.

---

## Explicitly out of scope

Do not build: return or TWR calculations, benchmark comparison, drawdown or
volatility, an HTTP API, OpenAPI specs, a web frontend, charts, an MCP server,
strategy classification, or any real-time/WebSocket ingestion.

If a design decision here would block any of those later, raise it rather than
silently working around it.
