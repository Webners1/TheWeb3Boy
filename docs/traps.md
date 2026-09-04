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

## 12. Annualising an irregular series

Volatility is annualised by the *observed* mean step length, not an assumed
daily cadence. Scaling a ~biweekly Hyperliquid backfill as if it were daily
overstates volatility by roughly √14. `volatility()` returns `meanStepDays`
so the caveat can be stated rather than hidden.

