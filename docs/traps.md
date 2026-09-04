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
- `value_per_unit` is reserved for a true per-unit NAV, reported or derived
  from flows. Deriving it is a later task's job.
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

