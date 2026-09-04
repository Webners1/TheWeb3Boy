# Vault benchmark analytics — full development plan

Cross-venue (CEX + DEX), cross-market (spot + perp) vault and lead-trader
performance, normalised and benchmarked against BTC / ETH / SOL buy-and-hold.

Zero paid APIs. TypeScript end to end.

**The thesis in one line:** the raw data is free and therefore commoditised —
the product is the *normalisation layer* and the *append-only archive*.

---

# Part 1 — Strategy

## 1.1 Why "free data" is a strategic problem, not just a budget constraint

A vendor selling paid Hyperliquid infrastructure makes the argument against
their own interest, and it is correct: the public Hyperliquid info API is free,
generous and self-serve, which is why almost every Hyperliquid wallet, dashboard
and trading app looks identical — a thin wrapper around info endpoints, a chart
from `candleSnapshot`, and a fills tab. If your product is the data, and the data
is a commodity, you compete on UI alone. That is a losing race.

So the free-tier constraint costs you nothing on access and everything on
differentiation. Three things are not commoditised:

1. **Normalisation.** Nobody makes a Hyperliquid perp vault, an OKX spot lead
   trader and an Enzyme vault comparable on one axis. This is genuinely hard
   (see Part 4) and is why nobody has done it.
2. **The archive.** Daily snapshots including entities that later die. Cannot be
   bought, cannot be backfilled, compounds daily from the moment you start.
3. **Follower-realised return.** The gap between what a vault reports and what
   its depositors actually got. Hyperliquid hands you the raw material for this
   for free and nobody uses it (see 2.2).

## 1.2 The single most important distinction in this document

**Levels vs universe.**

- **Levels** — what a vault's value was on a past date. Largely *recoverable*
  from on-chain sources, at reduced granularity (see the downsampling trap, 3.1).
- **Universe** — *who existed and was listed* on a past date. Recoverable
  on-chain (factory/creation events are permanent). **Never recoverable on CEX** —
  listing endpoints return currently-qualifying traders only, and a lead trader
  who blew up and lost status is gone from every endpoint forever, with no
  archive anywhere.

Everything about sequencing follows from this. Backfill the levels. Start the
cron immediately for the universe.

---

# Part 2 — Data availability matrix

## 2.1 Master table

| Source | Auth | Cost | Backfill depth | Universe history | Granularity | Verdict |
|---|---|---|---|---|---|---|
| Hyperliquid `/info` | none | free, 1200 weight/min/IP | full, but downsampled | yes (`createTimeMillis`, closed flag) | daily forward / ~biweekly historical | **core source** |
| Hyperliquid stats-data | none | free | hourly snapshots, current | yes — full registry | hourly | **core source** |
| OKX v5 public copytrading | none | free | partial, paginated | **no** | daily | **core source** |
| DefiLlama | none | free, no rate limit "for normal traffic" | full history | n/a | daily | **core, benchmarks** |
| Enzyme gRPC API | self-serve key | free | full timeseries | yes (subgraph) | native | core |
| Chamber/dHEDGE subgraph | Graph API key | 100k queries/mo free | full from factory deploy | yes — dead vaults retained | per-event | core |
| Graph Token API (HL) | JWT | $25 free ≈ 125k reqs | vault flow lifetime totals | partial | aggregate | supplementary |
| Copin API | issued key | ask them | leaderboards by period | unknown | daily/weekly/monthly | ask, don't assume |
| Binance / Bybit / Bitget | scrape only | eng. time + ToS risk | none | no | — | **cut** |
| Vybe / Birdeye (Solana) | key | paid | full | partial | per-trade | **cut** |

## 2.2 What you get, precisely

### Hyperliquid `POST https://api.hyperliquid.xyz/info`

Free, self-serve, **1200 request weight per minute per IP**. WebSocket caps at
1000 subscriptions per IP (irrelevant on a daily-snapshot model).

**`{"type":"vaultSummaries"}`** returns per vault: `name`, `vaultAddress`,
`leader`, `tvl` (decimal *string*), `isClosed`, `createTimeMillis`, and
`relationship.type` distinguishing standalone (`"normal"`) from parent/child
vaults.

> **Trap.** Hyperliquid's own docs note `vaultSummaries` returns vaults that are
> **less than 2 hours old**. It is a new-vault feed, not a registry. Do not build
> your universe on it.

**`https://stats-data.hyperliquid.xyz/Mainnet/vaults`** — hourly snapshots of
**all** vaults, plain static JSON, no auth. *This is your actual vault registry.*
It is the endpoint the community tooling uses and the one most people miss.

**`{"type":"vaultDetails","vaultAddress":"0x..."}`** returns:

```
name, vaultAddress, leader, description
portfolio: [ [period, { accountValueHistory: [[tsMillis, "value"], ...],
                        pnlHistory:          [[tsMillis, "value"], ...],
                        vlm: "..." }], ... ]
   periods: day | week | month | allTime | perpDay | perpWeek | perpMonth | perpAllTime
apr, leaderFraction, leaderCommission
followers: [ { user, vaultEquity, pnl, allTimePnl,
               daysFollowing, vaultEntryTime, lockupUntil } ]
maxDistributable, maxWithdrawable
followerState  (null unless you pass the optional `user` field)
relationship (parent/child linkage)
```

Position, equity and history values are **decimal strings**; `apr`,
`leaderFraction`, `leaderCommission`, `maxDistributable`, `maxWithdrawable` are
JSON numbers. Timestamps are **milliseconds**.

**The `followers` array is the most under-exploited free dataset in this
space.** For every depositor you get entry time, current equity, current PnL,
all-time PnL and days following. That lets you compute the **distribution of
realised depositor returns** and compare it to the vault's headline number —
the lead-vs-follower gap that no incumbent publishes. Hyperliquid gives it away
and nobody uses it. Snapshot this daily; the cross-section decays as depositors
exit.

### OKX v5 — public copytrading (no auth)

```
GET /api/v5/copytrading/public-config              platform configuration
GET /api/v5/copytrading/public-lead-traders        rankings
GET /api/v5/copytrading/public-stats               per-trader statistics
GET /api/v5/copytrading/public-pnl                 daily PnL
GET /api/v5/copytrading/public-weekly-pnl          weekly PnL
GET /api/v5/copytrading/public-current-subpositions open positions
GET /api/v5/copytrading/public-subpositions-history position history
GET /api/v5/copytrading/public-preference-currency  currency preferences
GET /api/v5/copytrading/public-copy-traders         copier list for a lead
```

Covers **both spot and perp** leads (spot leads cannot copy futures and vice
versa — they are distinct populations, tag them). Minimum copy ticket is
10 USDT per order. `public-copy-traders` plus subposition history is your one
CEX-side path to approximating follower-realised return.

> **Trap.** `public-lead-traders` lists *currently qualifying* leads only. A
> delisted trader is unrecoverable. This is the survivorship hole and the reason
> the cron starts in week one.

Verify OKX's published rate limits and their ToS on redistribution before you
build a paid product on top. This is a real open question, not a formality.

### DefiLlama — free, no auth, no rate limit for normal traffic

```
https://api.llama.fi          TVL, protocols, DEX volumes, fees/revenue
https://coins.llama.fi        current + historical prices  ← your benchmark spine
https://yields.llama.fi       50,000+ yield pools
https://stablecoins.llama.fi  stablecoin supply
```

31+ endpoints, no authentication. Pro is $300/month for higher limits and 38
extra endpoints (unlocks, bridges, treasuries) — **you do not need it**. Tracks
roughly 461 chains and 8,000+ protocols; most "TVL" figures cited anywhere on
the internet are DefiLlama underneath.

This solves BTC/ETH/SOL daily closes completely and permanently, for free.

### Enzyme

gRPC API with a first-party TS client `@enzymefinance/api`, plus plain HTTP if
you prefer. Key self-serves from `app.enzymefinance.finance/account/api-tokens`.
Backed by Enzyme's own subgraphs plus off-chain data they curate (vault
descriptions, performance data). The endpoint you want is **`GetVaultTimeSeries`**
— vault performance timeseries, directly, no reconstruction.

### Chamber (formerly dHEDGE)

Non-custodial tokenised vaults on Ethereum L2s. Every trade, deposit and
withdrawal is recorded on-chain and verifiable by vault contract address; no
lock-ups; managers cannot withdraw depositor funds. The subgraph **dynamically
tracks any fund created by the dHEDGE factory** — which is why dead vaults stay
queryable and on-chain survivorship bias is solvable.

Note the rebrand: searching "Chamber" finds the product, "dHEDGE" finds the docs
and repos. Both are live.

### Graph Token API — Hyperliquid endpoints

```
GET /v1/hyperliquid/vaults             leader, lifetime deposits/withdrawals/
                                       distributions/leader commissions,
                                       depositor + event counts, last activity
GET /v1/hyperliquid/vaults/depositors  per-depositor breakdown
GET /v1/hyperliquid/users              vault trading PnL/volume
                                       (vaults trade as normal accounts)
GET /v1/hyperliquid/platform
```

Auth: `Authorization: Bearer <JWT>` from The Graph Market dashboard. Hyperliquid
endpoints are **$2 per 10K requests**, and the free tier grants **$25 of total
usage** ≈ 125,000 requests. Rate limit 200/min.

> **Trap.** Free tier caps **items returned at 10, batch size 1**. Fine for a
> nightly batch, useless for interactive queries. Another argument for
> snapshotting into your own DB rather than proxying.

### Copin

Documented API at `https://api.copin.io`, e.g.
`GET /leaderboards-v2/page?protocol=GMX&statisticType=MONTH&limit=10&sort_by=ranking`
with an `X-API-KEY` header. Docs at `api-docs.copin.io`. Keys are Copin-issued —
**email them.** They index 700,000+ traders across 20+ perp DEXes and a
data-partnership ask costs you one email. Do not scrape them.

---

# Part 3 — Data traps

These will each cost you a day if you find them in production instead of here.

## 3.1 The downsampling trap — this changes your backfill expectations

`vaultDetails.portfolio` `allTime` bucket returns a **fixed downsampled series of
roughly 93 data points** spanning the vault's entire history. CoinGecko's HLP
analysis had to resample to a biweekly cadence to get evenly spaced points, and
ended up with 83 usable points for a three-year vault.

**Consequence:** you cannot get daily historical granularity from the Hyperliquid
API. Backfill gives you a coarse curve — roughly biweekly for a mature vault.
Only forward daily snapshots give daily resolution. So:

- 6-month benchmark comparisons from backfill are *shaped* correctly but coarse.
- Drawdown computed from a ~biweekly series **understates true max drawdown**,
  possibly badly. Never publish a backfilled drawdown without labelling its
  sampling resolution.
- Store a `sampling` column: `'daily'` vs `'downsampled'`. Metrics computed
  across a boundary must be flagged.

## 3.2 `pnlHistory` is cumulative, not periodic

On the `allTime` bucket, `pnlHistory` is accumulated profit **since inception**,
not a per-period measure. `accountValueHistory` is the account value / total
deposited at each snapshot. Differencing the wrong one silently produces garbage.

## 3.3 Value is not NAV per share

`accountValueHistory` moves with deposits and withdrawals. It is *not*
NAV-per-share and must never be used directly as a return series. You derive
per-share value from account value net of flows, or you use `pnlHistory`
deltas against average equity. Getting this wrong reproduces exactly the
money-weighted distortion you are building the product to expose.

## 3.4 Decimal strings, not floats

Hyperliquid returns equity, PnL and history values as **decimal strings**. Parse
to a decimal type. Postgres `numeric`. Never IEEE floats anywhere in the pipeline —
a benchmark product that shows `0.30000000000000004` is dead on arrival.

## 3.5 Empty array is a valid response

`vaultSummaries` "may be empty depending on platform state". A source returning
HTTP 200 with `[]` is the failure mode that silently destroys a dataset. Assert
row counts against a band around yesterday's before committing a run.

## 3.6 The Graph Hosted Service is dead

Fully deprecated in 2026. Old `api.thegraph.com/subgraphs/name/...` endpoints you
find in blog posts and GitHub READMEs will not work. Use Subgraph Studio (test,
rate-limited) or `gateway.thegraph.com/api/<key>/subgraphs/id/<id>` (production).

## 3.7 Milliseconds, lowercase hex, and parent/child vaults

Timestamps are ms. Addresses must be lowercase 0x hex. `relationship.type`
distinguishes standalone from parent/child vaults — **double-counting
parent+child TVL is an easy and embarrassing bug.**

---

# Part 4 — Existing work to stand on

## 4.1 SDKs and libraries

| What | Use it for |
|---|---|
| `@nktkas/hyperliquid` | Unofficial but well-maintained TS SDK. Typed info-endpoint access. This is what the good community projects use. |
| `@enzymefinance/api` | First-party Enzyme client, browser + node. |
| `@enzymefinance/sdk` | On-chain interaction; has `example-api-web` and `example-api-node` in-repo. |
| `defillama-sdk` (Python) / plain fetch (TS) | Thin wrappers; the REST API is simple enough to call directly. |
| `ccxt` | Only if you later add CEXs. Common interface across Bybit/Bitget/OKX/Gate/Binance/Hyperliquid. |

## 4.2 Repos worth reading before writing a line

- **`mgalihpp/hyperliquid-tracker`** — Next.js 15 + TypeScript + `@nktkas/hyperliquid`,
  **and it ships an MCP server published to npm as `hyperliquid-tracker-mcp`.**
  Read `mcp/src/server.ts` for the exact MCP-over-Hyperliquid pattern you want in
  your phase 4. This is your single highest-value reference repo.
- **`gordonjun2/hyperliquid-analysis`** — Python. Polls the **stats API** for top
  vaults by TVL, filters by minimum TVL, diffs asset positions between runs, and
  persists to JSON. Read it for stats-endpoint usage and its change-detection loop
  — that loop is 80% of your metadata-drift capture.
- **`StreetJammer/hyperliquid-vault-analyzer`** — vault portfolio optimisation and
  risk analysis. Read the metric definitions, ignore the ML.
- **`PotluckProtocol/HyperliquidWalletAnalyzer`** — Next.js + Prisma, strategy
  detection and pattern recognition from trade history. Relevant to
  auto-classifying `strategy_category` in phase 5.
- **`dhananjaypai08/HyperLiquid-Agent`** — vault data by APR + leaderboard
  addresses with LLM querying. A rough version of your phase 4.
- **`buddies2705/awesome-perp-dex`** — ~200-entry curated map of perp DEXes,
  terminals, analytics, copy trading, bots, MCPs and infra. Read this first for
  territory, not code.
- **`dhedge/dhedge-subgraph`, `dhedge/dhedge-v2-subgraphs`** — schema and mappings.
- **`dhedge/DefiLlama-Adapters`, `dhedge/dimension-adapters`** — see 4.4.
- **`avantgardefinance/enzyme-bot`** — shows subgraph query codegen (`yarn codegen`)
  and the comptroller-proxy / fund-deployer "release" concept you need to handle
  Enzyme version differences.
- **`vybenetwork/solana-trader-pnl-api`** — production-ready reference
  implementation with a live demo, if you ever revisit Solana.

## 4.3 Methodology references

- CoinAPI's survivorship-bias writeup: define the tradable universe **as it
  existed at time t**, include instruments that later delisted, and use only
  information available up to t. Written about assets; apply it verbatim to
  vaults and lead traders.
- Concretum Group's CMC survivorship-free dataset notebook — a working pipeline
  for building a universe that includes dead entities.
- The Keyrock on-chain vs traditional asset management study — useful framing and
  a source of sane comparison baselines.

## 4.4 The clever bit: let other people do your integration work

**Read the DefiLlama adapters.** dHEDGE maintains its *own* DefiLlama adapter and
dimension adapters, in public, on GitHub. That source code is a free, precise
specification of how the protocol itself computes TVL — methodology you would
otherwise have to reverse-engineer. And once the adapter is merged, DefiLlama's
free API serves you the computed result. You get someone else's integration work,
their methodology, and their hosting, at zero cost.

Generalise this: DefiLlama's adapter repo is an open-source, community-maintained
integration layer for 8,000+ protocols. When you want to add a venue, check
whether an adapter already exists before writing an indexer. If one doesn't and
you need it, **write and submit the adapter** — the maintainers review and merge,
and you get free permanent hosting of your own integration plus distribution.

**Ask before you scrape.** Copin publishes API docs and issues keys. Blofin
already computes Sharpe, Sortino and Calmar on its leaderboard. These are one
email each. A data partnership costs a founder ten minutes and gets you a legal,
stable, supported feed. Scraping gets you a fragile pipeline, ToS exposure, and
nothing to point at in a due-diligence conversation.

**On scraping monitoring sites generally:** their frontends do call JSON
endpoints, and yes you could use them. Do not build your core on it. It is
fragile, it is usually against ToS, and — the actual killer — you cannot sell a
dataset assembled that way. If you use any such endpoint, check robots.txt and
terms, cache hard, send an identifying user-agent, and treat it as decoration
that can vanish, never as a dependency.

---

# Part 5 — Design principles

1. **Raw is append-only. Derived is disposable.** Snapshots are never mutated.
   Metrics are a pure function of snapshots — droppable and recomputable. Fix the
   function, rerun, never lose ground truth.
2. **One atom: value per share, per entity, per day.**
3. **Every source is an adapter.** Adding a venue is one new file implementing one
   interface. No source-specific logic escapes its adapter.
4. **Validate at the boundary.** Every response through a schema before it touches
   the DB. External APIs change shape without notice.
5. **Provenance on every row.** `source`, `fetched_at`, `raw_ref`, `sampling`.
   "Where did this number come from" must be a query, not a guess.
6. **Semantics live in the database.** A metric only a React component can
   interpret is invisible to an AI later.
7. **Never publish a number you cannot defend.** Every headline figure carries
   `days_covered`, `is_full_window` and `sampling`.

---

# Part 6 — Stack

| Layer | Choice | Why |
|---|---|---|
| Language | TypeScript, Node 22 LTS | Enzyme ships a first-party TS client; `@nktkas/hyperliquid` is the best HL SDK; one language across ingest/API/web = one domain model. |
| Monorepo | pnpm workspaces + Turborepo | Shared types without publishing. Build caching keeps CI inside free minutes. |
| Database | Postgres (Supabase free tier) | Under ~1M rows/year. Window functions do all your maths. Not ClickHouse — wrong scale for years. |
| DB access | Drizzle ORM + drizzle-kit | Schema is readable plain TypeScript, migrations are reviewable SQL, SQL-first for analytical queries. Also: a model reading a Drizzle schema understands your domain instantly. |
| Numerics | `decimal.js` in TS, `numeric` in PG | Never floats. See trap 3.4. |
| Validation | Zod | One definition → runtime validation + TS types + OpenAPI spec. |
| Scheduler | GitHub Actions cron | Free, version-controlled, logged, no server. |
| API | Hono + `@hono/zod-openapi` | Tiny, edge-capable, generates real OpenAPI 3.1 from the Zod schemas you already wrote. The spec is what makes this machine-readable and sellable. |
| Frontend | Next.js App Router, static generation | Pages pre-render from the DB at build. No user traffic hits the DB, so you never leave free tiers. |
| Charts | Recharts | Sufficient, small, no licence questions. |
| Styling | Tailwind + shadcn/ui | You own the component code. |
| Object storage | Cloudflare R2 or Supabase Storage free tier | Gzipped raw payloads. |

**Deliberately not chosen:** Python/pandas (the maths is arithmetic over ordered
series; a second language doubles CI and deploy surface), ClickHouse/Timescale
(premature; revisit past ~50M rows), a message queue (a daily cron does not need
Kafka), GraphQL (REST + OpenAPI is what agents and integrators read).

---

# Part 7 — Repository layout

```
vaultbench/
├─ packages/
│  ├─ db/          Drizzle schema, migrations, seed
│  ├─ core/        return maths, benchmarking, metric definitions — ZERO I/O
│  ├─ sources/     one adapter per venue + the Source interface
│  ├─ ingest/      daily job: fetch → validate → upsert → archive raw
│  ├─ backfill/    one-shot historical loaders
│  ├─ compute/     recompute derived metrics from snapshots
│  ├─ api/         Hono app + OpenAPI spec
│  └─ mcp/         MCP server (phase 4, thin wrapper over core)
├─ apps/
│  └─ web/         Next.js
└─ .github/workflows/
   ├─ snapshot.yml
   └─ recompute.yml
```

`core` having zero I/O is load-bearing: it makes the maths trivially testable and
lets the MCP server, the API and any future backtester share one implementation.

---

# Part 8 — Schema

```sql
entities(                                  -- vault OR lead trader; one model
  id                uuid primary key,
  source            text not null,         -- 'hyperliquid'|'okx'|'enzyme'|'chamber'
  external_id       text not null,
  kind              text not null,         -- 'vault' | 'lead_trader'
  name              text not null,
  venue             text not null,
  venue_type        text not null,         -- 'cex' | 'dex'
  market_type       text not null,         -- 'spot' | 'perp' | 'mixed'
  strategy_category text,                  -- 'directional'|'neutral'|'yield'|null
  base_currency     text not null,
  inception_date    date,
  parent_entity_id  uuid references entities,   -- HL parent/child vaults
  status            text not null,         -- 'active' | 'closed' | 'delisted'
  first_seen_at     timestamptz not null,
  last_seen_at      timestamptz not null,
  unique (source, external_id)
)

entity_snapshots(                          -- THE ATOM. append-only.
  entity_id      uuid references entities,
  as_of          date not null,
  value_per_unit numeric(38,18) not null,  -- NAV/share or derived index
  account_value  numeric(28,8),            -- raw, flow-contaminated
  cum_pnl        numeric(28,8),
  aum_usd        numeric(20,2),
  sampling       text not null,            -- 'daily' | 'downsampled'
  nav_quality    text not null,            -- 'reported' | 'derived'
  fetched_at     timestamptz not null,
  raw_ref        text,
  primary key (entity_id, as_of)
)

entity_flows(                              -- deposits/withdrawals, for TWR
  entity_id uuid, as_of date,
  net_flow_usd numeric(28,8),
  primary key (entity_id, as_of)
)

depositors(                                -- HL followers array; the gold
  entity_id uuid references entities,
  as_of date not null,
  depositor text not null,
  equity numeric(28,8), pnl numeric(28,8), all_time_pnl numeric(28,8),
  days_following int, entry_time timestamptz, lockup_until timestamptz,
  primary key (entity_id, as_of, depositor)
)

benchmark_prices(
  symbol text, as_of date, close_usd numeric(20,8),
  source text default 'defillama',
  primary key (symbol, as_of)
)

entity_metadata_history(                   -- SCD-2, drift capture
  entity_id uuid, valid_from date, valid_to date,
  name text, strategy_category text,
  fee_profit_share numeric(6,4), fee_management numeric(6,4),
  leader_commission numeric(6,4), status text,
  primary key (entity_id, valid_from)
)

entity_metrics(                            -- derived, TRUNCATE-safe
  entity_id uuid, as_of date, window_days int,
  twr numeric(12,6),
  bench_twr_btc numeric(12,6), bench_twr_eth numeric(12,6), bench_twr_sol numeric(12,6),
  alpha_btc numeric(12,6),
  max_drawdown numeric(12,6), volatility numeric(12,6),
  follower_median_return numeric(12,6),    -- from depositors
  follower_gap numeric(12,6),              -- headline minus median follower
  days_covered int, is_full_window boolean, sampling text,
  primary key (entity_id, as_of, window_days)
)

ingest_runs(id uuid, source text, started_at timestamptz, finished_at timestamptz,
            status text, rows_written int, rows_expected int, error text)

metric_definitions(key text primary key, label text, description text,
                   unit text, direction text, caveats text)
```

`metric_definitions` is the AI-readability table. `alpha_btc` means nothing to a
model alone; a row reading *"return of the entity minus return of holding BTC
over the same window, net of entity fees; positive is better; unreliable when
sampling='downsampled'"* means everything.

Indexes: BRIN on `entity_snapshots(as_of)`, btree on
`entity_metrics(entity_id, window_days)`, btree on `depositors(entity_id, as_of)`.

---

# Part 9 — Adapter interface

```ts
export interface Source {
  id: string;
  listEntities(): Promise<EntityDescriptor[]>;
  snapshot(date: Date): Promise<RawSnapshot[]>;
  backfill?(entityId: string): Promise<RawSnapshot[]>;   // optional
  listDepositors?(entityId: string): Promise<Depositor[]>;
}
```

Implementation order: `hyperliquid` → `defillama` → `okx` → `enzyme` → `chamber`.

---

# Part 10 — Return maths (`packages/core`)

**Time-weighted return** from a value-per-unit series is `v[end]/v[start] - 1`.
This is why value-per-unit is the atom: it already neutralises flows.

**Deriving it where the venue gives you account value and flows** (Hyperliquid):
chain-link sub-period returns across each flow event, Modified Dietz as a fallback
when flow timing within a period is unknown. Tag the result `nav_quality='derived'`.

**Where only ROI is published** (some CEX leads): tag `nav_quality='reported'` and
**exclude from headline rankings**. Mixing reported money-weighted ROI with
derived TWR is precisely the lie every existing leaderboard tells; if you repeat
it you have no product.

**Benchmark counterfactual:** same window, same start date,
`bench_twr = close[end]/close[start] - 1`, minus one entry swap cost (~10bps) so
the comparison is fair rather than flattering to you.

**Fees:** entity returns net of profit share and management fee. Hyperliquid gives
you `leaderCommission` and `leaderFraction` directly. Record whether the venue
reported gross or net.

**Windows:** never fabricate. Return `days_covered` and `is_full_window`; the UI
labels short histories "since inception".

**Follower gap:** from `depositors`, compute each depositor's return as
`all_time_pnl / (equity - all_time_pnl)`, take the median, subtract from the
headline. Publish it. Nobody else does.

**Category-aware presentation:** `core` returns numbers; the UI reads
`strategy_category` before choosing the headline. A market-neutral vault "losing"
to BTC in a bull run is not underperforming, and presenting it that way is the
same dishonesty in the opposite direction.

---

# Part 11 — Build phases

### Phase 0 — backfill + cron (week 1). Ship nothing else.

**0a. Backfill (one-time).**

| Data | Depth | Granularity |
|---|---|---|
| BTC/ETH/SOL closes | full | daily |
| Enzyme vault series | full | native |
| Chamber/dHEDGE series | full from factory deploy | per-event |
| Chamber/dHEDGE **dead** vaults | full | per-event |
| Hyperliquid vault history | full | **~93 points total — coarse** |
| OKX lead trader PnL | partial, paginated | daily |
| OKX **delisted** traders | **none, ever** | — |

**0b. Daily cron.** Captures the three things backfill can never give you:
CEX universe composition, metadata drift, and restatements. Plus the depositor
cross-section, which decays as people exit.

Archive the raw gzipped payload from day one. When you find a parsing bug in
month four — you will — you reparse instead of losing four months.

Roughly 400–600 lines. Highest-value week of the project.

### Phase 1 — normalisation (weeks 2–4)
`core` + `compute`. Add OKX, Enzyme, Chamber adapters. Flow reconstruction and
TWR derivation. Hand-tag `strategy_category` for the first few hundred entities —
a classifier now would poison the dataset. Full test suite against fixed fixtures.

### Phase 2 — read API (week 5)
Hono + zod-openapi. `/entities`, `/entities/{id}`, `/entities/{id}/series`,
`/compare?entity={id}&bench=BTC,ETH,SOL`, `/metrics/definitions`,
`/entities/{id}/followers`. Publish `/openapi.json` from day one.

### Phase 3 — the card (week 6)
Next.js, statically generated, rebuilt nightly after the snapshot job.

### Phase 4 — the AI layer
Small, because of how phases 0–3 were built. MCP server wrapping the same `core`
functions: `list_entities`, `get_series`, `compare_to_benchmark`,
`explain_metric`, `find_similar`. Read `mgalihpp/hyperliquid-tracker`'s
`mcp/src/server.ts` for the pattern. The OpenAPI spec already lets any agent call
the REST API. `metric_definitions` supplies the semantics. Add
`/entities/{id}/narrative` returning **structured facts, not prose**, so
generation stays out of your backend.

### Phase 5 — expand
Second CEX (via partnership, not scraping), auto-categorisation, drift alerts,
and the choice between a B2B data API and an allocator tool. Let inbound decide.

---

# Part 12 — Operations

- **Idempotent ingest.** Upsert on `(entity_id, as_of)`. Re-running a day is safe.
- **Never delete an entity.** Mark `status`, keep every snapshot.
- **Alert on silence, not just errors.** Assert `rows_written` within a band of
  `rows_expected` (yesterday's count). See trap 3.5.
- **Zod failures abort the run** rather than writing partial garbage.
- **Retention:** raw payloads 12 months, snapshots forever.
- **One IP for Hyperliquid.** The 1200 weight/min cap is per IP; GitHub Actions
  runners rotate IPs, which helps you but makes throttling non-deterministic.
  Rate-limit client-side to ~10 req/s regardless.

---

# Part 13 — Cost

Supabase free, GitHub Actions free minutes, Vercel hobby, R2 free tier.
Realistically **$0–10/month through year one**.

The Graph is the only ceiling you could hit, and only if you proxy user queries
instead of snapshotting — which this design does not.

The real cost is discipline: running the snapshot every single day from week one,
and resisting real-time and breadth, which are how this project dies.
