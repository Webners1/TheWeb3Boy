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

## 16. Enzyme's schema is public; only the data is behind the key

This trap used to say the Enzyme adapter could not be written because its
response shape was unverifiable without a key. That premise was wrong, and it
cost a phase of delay.

The field names are published openly on the Buf Schema Registry. No
credentials, no account:

```
buf export buf.build/avantgardefinance/enzyme -o <dir>
```

That returns the complete `.proto` set — every message, field, type and enum
the API can return. The key gates the *data*, not the contract. The lesson
generalises past Enzyme: before recording a shape as unknowable, check whether
the vendor publishes a machine-readable schema somewhere other than the
endpoint you were denied. gRPC services usually do, and OpenAPI services often
do.

What the export established:

- Endpoint `POST https://api.enzyme.finance/enzyme.enzyme.v1.EnzymeService/<Method>`,
  headers `authorization: Bearer <key>` and `connect-protocol-version: 1`.
  This is Connect-over-HTTP, so standard `fetch` is enough — no gRPC client
  and no new dependency.
- Relevant methods: `GetVaultList`, `GetVault`, `GetVaultTimeSeries`,
  `GetVaultDepositors`, `GetVaultConfiguration`.
- Keys are free and self-serve at
  https://app.enzyme.finance/account/api-tokens.

The adapter is now written against that contract. Three things the schema
made visible, none of which would have been guessed:

- **Every numeric field is a 32-bit `float`.** Trap 19 below.
- **`price_is_valid` / `share_price_valid` exist, and matter.** Enzyme tells
  you when it could not price a vault's holdings. The share value is still
  populated on those points, and still wrong. Both adapters' paths drop them.
- **`net_share_value` is named net by the vendor**, which is why
  `FEE_BASIS.enzyme` is `net`. Applying our own haircut would double-count.

What a schema cannot tell you is semantics — Chamber's `adjustedTokenPrice`
was a perfectly plausible name for something entirely different (trap 12). So
`net_share_value` needed reconciling against something independent before it
could be trusted.

**It reconciles, and no external source was needed**, because three of
Enzyme's own fields cross-check. For vault `0x27f23c7` on Ethereum:

```
grossAssetValue / numberOfShares = 2248.5609   (gross, per share)
netShareValue                    = 2247.9694   (net, per share)
```

Net sits 0.026% *below* gross-per-share, which is accrued but unsettled fees.
That single comparison establishes all three things in doubt: the field is
per-share rather than a total, it is net rather than gross, and its units
match `grossAssetValue`. Any mis-scaling — wei, basis points, a total
mistaken for a per-unit — would throw the ratio out by orders of magnitude
rather than by three basis points. The check is kept as a test in
`packages/sources/src/enzyme/adapter.test.ts`, since it is what a scaling
regression would fail first.

Live figures for the record: 1738 vaults on Ethereum, of which 730 have a
priced share. The other 1008 have no share price at all — 645 with a valid
flag and a zero price, 363 with neither. Not one vault has a price the
validity flag rejects, and not one rejected vault holds over $1,000, so
dropping them loses nothing real.

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
## 19. A schema constrains the shape, never the precision

Enzyme sends money as bare JSON numbers rather than decimal strings, so every
value has been through a binary float before we can touch it. That much is
unavoidable. The instructive part is what came next, because **this trap was
written backwards the first time.**

Enzyme's published protobuf declares `net_share_value`, `gross_asset_value`
and every fee `rate` as `float` — 32-bit, about 7.2 significant decimal
digits. Reading that, the obvious conclusion was that values arrive lossy and
the danger is *invented* precision: JavaScript widens a float32 to a double,
and the float32 nearest 1.05 prints as `1.0499999523162842`, so storing that
asserts sixteen significant digits about a seven-digit source. The first
implementation therefore snapped every value to the nearest float32 and
returned the shortest string that round-tripped to it.

The live API demolished that. Not one observed value is float32-representable:

| field | wire value | nearest float32 |
| --- | --- | --- |
| `netShareValue` | `1688.2824302978102` | `1688.282470703125` |
| `netShareValue` | `1724.2856506965004` | `1724.28564453125` |
| `sharePrice` | `2246.9706589468947` | `2246.970703125` |

The JSON gateway emits full doubles. The `float` in the schema describes the
gRPC *binary* encoding and says nothing about what the JSON transport
delivers. The float32 treatment would have published `"1688.2825"` for the
first row — destroying nine digits of real data, in the name of precision
hygiene.

The rule is therefore **preserve, not round**, because both directions lie:

- *Adding* digits: widening a genuinely low-precision value and keeping the
  noise tail, which then renders as precision.
- *Dropping* digits: rounding to a precision the venue never claimed,
  silently discarding real information.

`wireNumberDecimalString` in `packages/shared/src/wire-number.ts` reproduces
the wire token exactly. JavaScript's `Number`-to-string is already the
shortest decimal that round-trips to the same double, which is what a Go
server produces when serialising one, so the function is one line plus the
expansion of exponential notation that `numeric` requires.

Three consequences worth keeping:

- **Verify precision against a live response, never against a schema.** A
  schema is authoritative about field names and nullability and worthless
  about how many digits actually arrive. This was caught only because a key
  turned up; a fixture generated from the proto would have agreed with the
  wrong implementation forever.
- The module is quarantined to `packages/sources/src/enzyme/` by the
  `json-number-quarantine` harness rule. It is a concession to the one venue
  that sends numbers instead of strings, not a general exemption from the
  no-floating-point rule. A future adapter reaching for it should be asking
  its venue for a string.
- A non-finite value throws rather than coercing to zero. A venue sending
  `NaN` is reporting a broken figure, and turning that into `0` converts "we
  don't know" into "it is worthless", which compounds through a return series.

## 20. Connect JSON omits zero values, and the default direction matters

Enzyme speaks Connect, whose JSON encoding drops zero-valued fields by
default. An absent number means `0` and an absent boolean means `false` — not
"missing".

For `price_is_valid` the direction of that default is load-bearing. A schema
that treated an absent validity flag as `true` would wave through exactly the
prices the flag exists to warn about, and it would do it silently, because a
mispriced vault still reports a plausible-looking share value. Absent reads as
invalid.

The same encoding has a second edge: a Connect server configured with
`UseProtoNames` emits `net_share_value` instead of `netShareValue`, and both
are valid protojson for the same field. Which one a deployment uses cannot be
observed without a key, so both are accepted and normalised once at the schema
boundary.

That is not the silent-fallback trap of trap 13. There, an unrecognised chain
code was quietly mapped to a different, *wrong* value. Here the two spellings
are the same field by the vendor's own spec, nothing is invented, and a third
spelling still fails the parse.


## 21. Alpha over a benchmark is meaningless without leverage

Verified against real data, and it is the first thing a reader will see.

The top entity by 90-day TWR in the current Chamber universe is a vault named
"Ethereum Bull 3X". Its published figures are all correct:

| field | value |
| --- | --- |
| `twr` | 2.21 |
| `bench_twr_eth` | 0.48 |
| `alpha_eth` | 1.74 |
| `volatility` | 1.89 |
| `max_drawdown` | 0.43 |
| `strategy_category` | `null` |

Every number there is arithmetically right. `alpha_eth` of 1.74 is also
analytically worthless: the vault is a 3x leveraged long on the very
benchmark it is being compared against. That is not 174 points of manager
skill, it is beta times three in a rising market. The same vault in a falling
market would print a spectacular negative alpha for the same reason, and
neither figure says anything about the manager.

Coverage travels with every figure (`days_covered`, `is_full_window`,
`sampling`, `nav_quality`) — but **leverage and market exposure do not**. The
metric that most invites a ranking is the one with the least disclosure
attached.

`strategy_category` was built for exactly this and is `null` here, because it
is hand-tagged and nothing has tagged the Chamber universe yet
(`data/strategy-tags.json`). A category of `directional` would let the reader
know the comparison is apples-to-apples-with-a-multiplier. It still would not
carry the multiplier.

**Resolved by publishing beta.** `entity_metrics` now carries `beta_btc`,
`beta_eth`, `beta_sol` and an `r_squared_*` for each, computed in
`packages/core/src/beta.ts` from data already held — no new source. Beta was
the cheapest of the three options considered and the least presumptuous, and
it does not preclude gating on `strategy_category` or ranking on a
risk-adjusted figure later.

On the same real 90-day window it does the job, and caught more than the vault
that prompted it:

| name | `alpha_eth` | `beta_eth` | `r_squared_eth` |
| --- | --- | --- | --- |
| Ethereum Bull 3X | 1.74 | 2.92 | 0.84 |
| Ethereum Maximizer | 0.77 | 1.95 | 0.74 |
| Archipelago Investment Firm | 0.08 | 0.96 | 0.86 |
| HODLINDICATOR | 0.07 | 0.96 | 0.86 |

"Ethereum Maximizer" is the case that justifies the work. It is roughly 2x
geared and **its name does not say so** — no amount of reading vault names
would have caught it, and a hand-applied `strategy_category` of `directional`
would have flagged it as market-exposed without ever revealing the multiplier.
Beta reads the leverage off the returns themselves. ("Test neutral Base", at
beta 0.97, is named neutral and is nothing of the kind.)

Three things learned in the doing:

- **Beta must never be published without r-squared.** A beta of 3 explaining
  98% of variance is a leveraged tracker; the same beta explaining 5% is two
  noisy series coinciding, and presenting that as gearing is its own lie.
- **Beta against the wrong benchmark invents leverage.** The same "Ethereum
  Bull 3X" vault reports three betas, and only one of them means anything:

  | benchmark | `beta` | `r_squared` |
  | --- | --- | --- |
  | ETH | 2.92 | 0.84 |
  | BTC | 4.02 | 0.68 |
  | SOL | 2.03 | 0.42 |

  Read off the BTC row alone, this is a 4x leveraged BTC position. It is
  nothing of the kind — it is 3x ETH, and the BTC and SOL figures are
  artifacts of how far ETH moves with them. Majors are correlated enough that
  a geared bet on one produces a plausible-looking beta against all three.
  The r-squared column is what picks the right lens: highest explained
  variance identifies the benchmark the entity is actually geared to. A
  consumer that shows one benchmark's beta without its r-squared will
  confidently state the wrong multiple against the wrong asset.
- **Returns must be paired over identical intervals.** An entity series may be
  `downsampled` to ~2-day spacing while benchmark closes are daily, and
  pairing by position would regress 2-day returns on 1-day returns — a step
  against half a step. Even with exact pairing the figure is an estimate on a
  downsampled series: a product rebalanced to 2x *daily* reads about 2.11 when
  measured on alternate days, because two geared daily steps do not compose
  into one geared two-day step. That convexity is the same effect that decays
  leveraged ETFs in choppy markets, and it is why the observed 2.92 for a
  nominal 3x is right rather than a bug.

Null means "cannot say", never zero: beta is undefined below three paired
intervals and when the benchmark did not move, and a zero there would assert
market-neutrality.

What remains: nothing here blocks a ranking, but `alpha_*` is still the
tempting sort key. The caveat text on all three alpha rows in
`metric_definitions` now names `beta_*` explicitly, so an agent reading the
table cannot obtain the return difference without being told what would
explain it. A UI must show beta next to alpha for the same reason.

## 22. A secret scanner that only reads code is not a secret scanner

Found the hard way, during this build. A real Enzyme API key was pasted into
`.env.example` — onto the commented `# ENZYME_API_KEY=` line, which reads as
inert and is not. `.env.example` exists in order to be committed. The key was
one `git add -A` away from being published, and **every check in this
repository passed**, because `no-hardcoded-secrets` only ever scanned `.ts`
files under `packages/` and `tools/`.

The rule was real, the enforcement had a hole exactly where a human would
actually put a secret: in the file that documents which secrets exist.

`tools/check-harness.mjs` now also scans `.env.example` for populated
assignments, including commented ones. Two things learned while writing it:

- **Detect by variable name, not by the shape of the value.** The first
  attempt inspected values and was wrong in both directions: it flagged
  `S3_REGION=auto` and `S3_FORCE_PATH_STYLE=true`, which are documentation,
  and any rule loose enough to permit those would also permit a short API
  key. A variable named `*_KEY` has no business carrying a value in a
  committed file, whatever that value looks like.
- **A local default is the point of an example file; a reachable one is not.**
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/vaultbench` is
  useful and safe. The same line pointing at a host someone can resolve is a
  leak, so an embedded password is allowed only for a local host.

The general lesson, which is not about env files: when a rule is written
down, check the enforcement covers the place the mistake would actually be
made. `no-hardcoded-secrets` was listed as `automated` in AGENTS.md and had
been since the first commit. It was automated over the wrong file set, and
nothing in the proof table could reveal that, because the table records
whether a check exists and not what it looks at.

## 23. Do not round-trip a UTF-8 file through PowerShell

Self-inflicted, during this build, and it corrupted a file that had been
correct for weeks.

Reordering sections in `docs/traps.md` was done with
`Get-Content | Set-Content -Encoding utf8`. On PowerShell 5.1 that is two
bugs in one pipeline:

- `Get-Content` decodes using the system ANSI code page, not UTF-8. Every
  multi-byte character comes back as its individual bytes reinterpreted as
  cp1252 characters.
- `Set-Content -Encoding utf8` then re-encodes those, and prepends a BOM.

The result is the classic double-encoding. An em-dash (U+2014, bytes
`E2 80 94`) became the three characters `â€`+U+201D and stayed that way in
the committed file. It hit 19 em-dashes plus a `Δ`, a `×`, a `√` and two
arrows in prose that predated the edit, so the damage was not limited to the
lines being changed.

It was caught only because a later edit failed to match its own anchor text,
and the mismatch showed the mojibake. A silent prose corruption has no test to
fail, and `git diff` looked plausible because the whole file was rewritten
anyway.

The rule: **edit files with tools that are UTF-8 by default.** Use the editor,
or Node's `readFileSync`/`writeFileSync` with an explicit `'utf8'`.
Never `Get-Content`/`Set-Content`/`Out-File` for content that may hold a
character above U+007F, and never for content that will be committed.

If it happens again, the repair is to map each character of a non-ASCII run
back to its cp1252 byte and decode the result as UTF-8, accepting only runs
that decode without a replacement character. Bytes `0x80`-`0x9F` need a
reverse cp1252 table; everything else maps to itself.

## 24. A relative ARCHIVE_ROOT splits the archive per package

`.env.example` documents `ARCHIVE_ROOT=./var/archive`, and for weeks that
looked like it worked. It did not. pnpm runs each package's script with that
package as the working directory, so the relative path resolved differently
depending on which job was running:

| job | where raw payloads actually landed |
| --- | --- |
| `pnpm ingest` | `packages/ingest/var/archive` |
| `pnpm backfill` | `packages/backfill/var/archive` |

Two archives, neither at the documented location, splitting the same entity's
raw payloads across directories. Found only by looking for the Enzyme payload
after a successful ingest and discovering that `var/archive` did not exist
at all.

Why this one matters more than it looks. The raw archive is the append-only
ground truth — the thing every derived figure can be re-checked against, and
the reason `entity_metrics` is safe to `TRUNCATE` and rebuild. Ground truth
scattered under `packages/*/var/` is ground truth that a stray clean step
discards without anyone noticing, because nothing reads it on the happy path.
A backup of `var/archive` would have captured nothing.

The failure was silent in both directions: the archive write succeeded, the
ingest logged `ok`, and the documented path stayed empty. There was no error
to see.

`resolveArchiveRoot` in `packages/shared/src/storage.ts` now resolves a
relative root against the workspace root — located by walking up for
`pnpm-workspace.yaml` — so `./var/archive` means one place no matter which
package is executing. An absolute root is left alone. The existing 27 payloads
were moved into the single archive rather than dropped; raw data is
append-only, including when the bug was ours.

The general shape of this, worth watching for elsewhere: **a relative path in
configuration is only meaningful next to a stated base.** In a monorepo the
working directory is not that base, because it changes per script.

## 25. A guessed `raw_ref` is worse than no `raw_ref`

`entity_snapshots.raw_ref` exists so a reader can find the payload a number
came from. The writer used to assemble it: Hyperliquid got
`vaultDetails/<id>`, everyone else got the bare external id, and the date in
the path was the snapshot's own `as_of`.

That is two independent guesses, and both were wrong for a backfill.

A Chamber history point from 2023-12-21, fetched on 2026-09-04, was archived
as `raw/chamber/2026-09-04/tokenPriceHistory/base:0x….json.gz`. The stored
`raw_ref` said `raw/chamber/2023-12-21/base:0x….json.gz`. All 60,558
backfilled Chamber rows pointed at a path that had never been written. OKX
was worse: ranks are paginated and the page number is part of the archive
key, so `lead-traders/<external_id>` was never a real path for any row.

A dangling pointer is worse than a null. Null says "no payload recorded". A
wrong path says "here it is" and sends the reader looking. The column's only
job is to resolve; a value that does not is a lie.

The adapter now reports the archive name, because only the adapter knows it.
The writer turns that name plus the *run* date into `raw_ref`, or writes
null if the adapter left the name unset. `packages/sources/src/raw-name.test.ts`
captures every `onRaw` call and asserts every snapshot's `rawName` is one of
them — Chamber, Enzyme, OKX (page number included), Hyperliquid.

The same pass stopped accumulating the universe in memory before writing.
Chamber at 60k rows survived that. Enzyme's 1,738 Ethereum vaults carry
daily history back to 2019, which is past a million `RawSnapshot` objects,
each holding `Decimal`s. The job would have died of heap exhaustion after
twenty minutes of polite fetching, with nothing written. History is now an
async iterable, one entity at a time, each committed in its own transaction
so an interrupted run leaves what it reached.