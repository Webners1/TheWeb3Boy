# VaultBench — Known Data Traps

These traps have already been identified. Read this file before writing an
adapter, a backfill, or any analytical query. When a new trap is discovered,
add it here — that is the whole point of the harness.

## 1. Downsampling Trap

The Hyperliquid `allTime` bucket returns a downsampled series (~93 points
across a vault's entire life), not a daily series. Mark it
`sampling='downsampled'`.

- Points are not adjacent days. Any period-over-period math across adjacent
  `allTime` points is wrong.
- Only points sourced from a same-day `day` bucket read may be written with
  `sampling='daily'`.
- Never publish a metric computed on a downsampled series without labeling
  its sampling resolution — e.g. a drawdown from a ~biweekly series
  understates true max drawdown.

## 2. Cumulative PnL

`pnlHistory` on the `allTime` bucket is cumulative since inception. Do not
difference it.

- Store the reported value verbatim in `entity_snapshots.cum_pnl`.
- Periodic PnL must come from buckets that report it per period — never from
  differencing cumulative points, which on a downsampled series (trap 1)
  span irregular, unknown intervals anyway.

## 3. Value is not NAV

`accountValueHistory` is flow-contaminated. Store as `account_value`, leave
`value_per_unit` null.

- A $10M deposit moves `accountValueHistory` by $10M with zero trading PnL.
  It is not a return series.
- `value_per_unit` on a snapshot is reserved for venues that genuinely publish
  a per-unit NAV. For Hyperliquid and OKX it stays null.
- The derived per-unit series lives in `entity_nav`, written by
  `packages/compute`, never back into the raw snapshot row. See the authority
  note in `AGENTS.md`.
- Never treat `account_value` deltas as performance.

## 4. Silent Failures

An HTTP 200 with an empty array is a valid response from sources but destroys
datasets. Assert row counts against yesterday's count.

- Compute `rows_expected` from the previous successful run's `rows_written`.
- If `rows_written` falls outside the accepted band around `rows_expected`,
  abort the run, roll back, and exit non-zero. Do not commit a partial
  dataset as success.
- Alert on silence, not just on errors.

## 5. Parent/child linkage is inverted

Hyperliquid `child` records are `{ type: "child" }` with no parent address.
The parent record lists `data.childAddresses`. Build the map from parent →
children, then set `parent_entity_id` on the children. Never sum TVL across
a parent and its children.

## 6. Followers are not always hex addresses

`followers[].user` can be the literal `"Leader"`. Do not validate depositors
as 0x hex.

## 7. OKX timestamps can be empty strings

Open subpositions return `closeTime: ""`. Treat empty string as null, not as
epoch 0.

## 8. A deposit is not a return, and neither is a withdrawal

`netFlow[t] = (accountValue[t] - accountValue[t-1]) - (cumPnl[t] - cumPnl[t-1])`.
Everything downstream depends on this one line being right.

- Chain-link sub-period returns: `r[t] = ΔPnL[t] / (accountValue[t-1] + 0.5 × netFlow[t])`.
- The 0.5 weight is Modified Dietz. A daily snapshot does not reveal when
  inside the day a deposit landed, so mid-period is the honest assumption.
  `entity_nav.method` records `simple` when there was no flow and the return
  is exact, `dietz` when it was estimated.
- If the denominator is zero or negative the period is not computable. The
  chain truncates rather than bridging — bridging invents a return nobody
  earned.

## 9. A total wipeout is a real -100%, but it cannot compound

A vault that reaches zero equity gets a final `entity_nav` point at 0. The
chain then ends. A later deposit is not a recovery, and multiplying out of
zero would present one.

## 10. Mixing reported ROI with derived TWR

Venue-published ROI is money-weighted; a TWR derived from flows is not. They
are different quantities and ranking them against each other is the error
every existing leaderboard makes. `entity_metrics.headline_eligible` is false
for `nav_quality='reported'` rows, and `packages/core/src/fees.ts` is the only
place that decides it.

## 11. Open question: is Hyperliquid `pnlHistory` gross or net of leader commission?

`packages/compute/src/fees.ts` treats Hyperliquid as `gross` and applies the
recorded `leaderCommission` to the gain. If that is backwards we are
*understating* vault returns, which for a benchmark product is the safe
direction to be wrong in — but it is unverified. Confirm against a vault where
the leader's realised commission can be observed independently, then update
`FEE_BASIS` and delete this entry.

## 12. Chamber's `adjustedTokenPrice` is not a price

On `tokenPriceHistory`, the field named `adjustedTokenPrice` is **cumulative
return since inception**, as a fraction. Per-unit value is `1 + value`.

How this was caught: real responses contain negative values (observed down to
`-0.55`), and a share price cannot be negative. Confirmed on two vaults —
`1 + lastValue` reconciles with `Fund.tokenPrice` in both cases.

- The first point of an `all` series is exactly `"0"`, meaning an index of 1,
  not a worthless vault.
- `tokenPrice` is `null` on every history point. Only the `Fund` list carries
  a real `tokenPrice`, and there it is **wei-scale with 18 decimals** while
  the history value is already decimal-scaled. Two scalings for one concept
  in one API.
- A value of `-1` or lower would mean total loss and is skipped: there is no
  positive index to continue from.

## 13. Chamber chain codes fall back silently

`allFundsByBlockchainCode` takes an untyped, case-insensitive string. An
unrecognised code may return a default chain's data rather than erroring, so
every row is checked against the code that was requested before it is
accepted. Without that check one typo duplicates a whole chain's universe
under the wrong key.

Chamber addresses are also **not unique across chains**, so the external id is
`chain:address`, never the bare address.

## 14. Chamber's rate limit is windowed, and bursting poisons the window

The Data API documents only "rate limits may apply". Measured: **50 requests
per rolling minute**, with no `Retry-After` header and no rate-limit headers
of any kind.

- A bucket of 5 req/s died about ten seconds into a 221-vault backfill.
- At 1 req/s the first 429 arrived at request **51**, after 56s. A separate
  run at 2 req/s also tripped at roughly 50 requests. Same ceiling, so it is
  a count per window and not a rate.
- 15 consecutive requests pass at 500ms spacing, which is why a short probe
  finds nothing. Any probe shorter than 50 requests will tell you the limit
  does not exist.

Two consequences, both implemented:

1. The adapter runs at **0.75 req/s** (45/min). A 221-vault chain takes about
   five minutes, which beats a run that dies halfway and writes nothing.
2. Exponential backoff is the wrong shape for a windowed quota. A 500ms→16s
   ramp burns all five retries inside the hot window and fails. `fetchJson`
   now waits out the window on a 429 — `Retry-After` when the server sends
   one, otherwise a 65s floor.

## 15. A TVL floor at discovery invents deaths

Polygon alone returns ~1,579 Chamber vaults, most of them dust, and the
temptation is to filter by TVL at ingestion. Do not. A vault that shrinks
below the floor would vanish from the universe and be marked `delisted` —
a death that never happened, in the one table whose whole purpose is an
honest survivorship record. Filter for presentation, never for ingestion.

The daily Chamber snapshot costs one request per chain regardless, because
the fund list already carries `tokenPrice`, so there is no cost argument for
a floor either.

## 16. Open: Enzyme is unbuilt because the shape is unverifiable

The Enzyme adapter is deliberately **not** written. What is known:

- Endpoint `POST https://api.enzyme.finance/enzyme.enzyme.v1.EnzymeService/<Method>`,
  headers `authorization: Bearer <key>` and `connect-protocol-version: 1`.
  This is Connect-over-HTTP, so standard `fetch` is enough — no gRPC client
  and no new dependency.
- Relevant methods: `GetVaultList`, `GetVault`, `GetVaultTimeSeries`,
  `GetVaultDepositors`, `GetVaultConfiguration`.
- Keys are free and self-serve at
  https://app.enzyme.finance/account/api-tokens.

What is not known: the response field names. They live only in the Buf schema
registry behind a key. An adapter written against guessed field names would
pass its own tests, fail its Zod parse in production, and cost a day to
diagnose. Get a key, capture fixtures the way
`tools/capture-chamber-fixtures.mjs` does, then write it.

The Chamber work is the argument for this rule: every field name there was
plausible and one of them (`adjustedTokenPrice`) meant something entirely
different from what it said. Trap 12.

## 17. Annualising an irregular series

Volatility is annualised by the *observed* mean step length, not an assumed
daily cadence. Scaling a ~biweekly Hyperliquid backfill as if it were daily
overstates volatility by roughly √14. `volatility()` returns `meanStepDays`
so the caveat can be stated rather than hidden.


## 18. `is_full_window` must not be decided by a day count

The obvious test for "is this really a 90-day return?" is
`daysCovered >= windowDays`. It is wrong, and it was shipped that way.

On a series sampled every two days, whether an observation lands exactly on
the window cutoff is a parity coin-flip against the window length. A
three-year-old Chamber vault therefore reported `is_full_window: false` for
90 days while reporting `true` for 365 — non-monotonic, and it made the one
field a reader checks before trusting a figure answer a different question
from the one they were asking. The tell was aggregate: a shorter window
showing *fewer* full-window entities than a longer one is arithmetically
impossible for honest data.

`spansWindow` in `packages/core/src/series.ts` asks the two questions that
are actually the ways a window fails to be full:

1. Did the record begin at or before the window opened? If not, the entity
   is younger than the window and this is not a 90-day return at all.
2. Does the record still run to the window's end, within one sampling step?
   If not, the figure is stale — a vault that stopped reporting two months
   ago must not present its last reading as current.

Sparse sampling *inside* a full window is not an incompleteness; it is
disclosed by `days_covered` and `sampling`. Keep the three fields answering
three different questions.

Note that `sampling` is a provenance label — which endpoint the rows came
from — not a measurement of spacing. A series tagged `daily` can still have
gaps. `days_covered` is the field that catches that.
