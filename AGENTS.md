# VaultBench — Harness Governance

These rules are binding on every agent and human working in this repository.
They exist to prevent classes of mistakes that have already been identified.
Read `docs/traps.md` before touching any adapter, job, or analytical query.

## Domain & Data Constraints

- No paid APIs allowed.
- No floating point anywhere in the data path. Parse with decimal.js, store as Postgres numeric.
- Raw data is append-only.
- Validate every external response with Zod before it touches the database.

## Security & Authority

- Never hardcode credentials or API keys. All secrets must be loaded via environment variables.
- Database write operations must be strictly scoped. The `ingest` job is the ONLY package authorized to write raw data. Adapters in `packages/sources` must have zero database imports.
- Derived tables (`entity_flows`, `entity_nav`, `entity_metrics`, `metric_definitions`) belong to `compute`, which must never write a raw table. See the authority note below.
- `packages/core` performs zero I/O: no fetch, no database handle, no clock, no environment. Data goes in as arguments.

## QA & Proof (CI/CD)

- Pre-Commit Guard: You must run native checks (e.g., `vitest`) and ensure they pass before declaring a task finished.
- Schema failures must hard-abort the run. Never write partial data.
- The GitHub Actions workflow (`snapshot.yml`) must fail loudly on a non-zero exit.

## Efficiency & Anti-Drift

- Let local truth govern the implementation. Use existing Zod primitives from `packages/shared` rather than rewriting them.
- Avoid architectural drift: Do not introduce new ORMs, message queues, or abstract wrapper layers. Stick strictly to standard Drizzle ORM and standard fetch.

## Repository map

| Path | Purpose |
| --- | --- |
| `packages/db` | Drizzle schema, migrations, client. All financial columns are `numeric`. |
| `packages/core` | Return maths, benchmarking, metric definitions. Zero I/O. |
| `packages/sources` | Source interface + one adapter per venue. Zero database imports. |
| `packages/ingest` | Daily snapshot job. The only package that writes raw data. |
| `packages/backfill` | One-shot historical loaders. Writes flow through the same guarded path. |
| `packages/compute` | Recomputes derived tables from raw snapshots. Writes derived data only. |
| `packages/api` | Hono + zod-openapi read surface. Reads the database, never writes. |
| `docs/openapi.json` | The published contract, checked in so a breaking change shows up in a diff. Regenerate with `pnpm openapi`. |
| `packages/shared` | Zod primitives, decimal helpers, logger, storage client, run guards. |
| `docs/traps.md` | Known data traps. Update it whenever a new one is discovered. |
| `data/strategy-tags.json` | Hand-assigned strategy categories. A tag is a reviewable diff, never a row typed into production. |

## Proof — which rule is enforced by what

A rule that nothing executes is a wish, not a constraint. Every rule above is
listed here with the check that enforces it. Run all of them with `pnpm check`.

| Rule | Enforced by | Kind |
| --- | --- | --- |
| No floating point in the data path | `tools/check-harness.mjs` (`no-floating-point`) | automated |
| Money columns are Postgres `numeric` | `packages/db/src/schema.test.ts` | automated |
| Numeric reaches TypeScript as `string` | `packages/db/src/schema.test.ts` | automated |
| Never hardcode credentials or API keys | `tools/check-harness.mjs` (`no-hardcoded-secrets`) | automated |
| `packages/sources` has zero database imports | `packages/sources/src/authority.test.ts` | automated |
| Database writes are strictly scoped | `tools/check-harness.mjs` (`scoped-db-writes`) | automated |
| Raw payloads are append-only | `LocalFileArchive.put` opens with `wx`; snapshots are keyed `(entity_id, as_of)` | automated |
| Pre-Commit Guard runs native checks | `.githooks/pre-commit` — install with `pnpm run hooks:install` | automated |
| `snapshot.yml` fails loudly on non-zero exit | `.github/workflows/snapshot.yml` runs the guard, typecheck and tests before ingest | automated |
| No paid APIs | review-time | judgement |
| Validate every external response with Zod | `packages/sources/src/schemas.test.ts` plus adapter `parseOrThrow` | automated |
| Reuse `packages/shared` Zod primitives | review-time | judgement |
| No new ORMs, queues, or wrapper layers | review-time | judgement |
| Schema failures hard-abort the run | `packages/ingest/src/job.ts` records `ingest_runs.status='failed'` and writes nothing | automated |
| Assert row counts against yesterday's | `packages/ingest/src/guards.test.ts` + `writeSourceBatch` | automated |
| `packages/core` performs zero I/O | `tools/check-harness.mjs` (`core-zero-io`) | automated |
| `compute` never writes a raw table | `tools/check-harness.mjs` (`derived-writes-only`) | automated |
| Derived tables are rebuildable | `packages/db/src/schema.test.ts` (`derived tables are rebuildable`) | automated |
| Every published metric has semantics in the DB | `packages/compute/src/recompute.test.ts` (`defines every published entity_metrics column`) | automated |
| Coverage travels with every figure | `entity_metrics.days_covered`/`is_full_window`/`sampling` are `NOT NULL`, asserted in `schema.test.ts` | automated |
| `is_full_window` means the record spans the window, not that a day count was met | `spansWindow` in `packages/core/src/series.ts` + `metrics.test.ts` (sampling parity, stale record) | automated |
| Money-weighted ROI is excluded from headline rankings | `packages/core/src/fees.ts` `isHeadlineEligible` + `recompute.test.ts` | automated |
| An unverified venue is not ranked | `isSourceRankable` in `packages/compute/src/fees.ts` + `recompute.test.ts` | automated |
| Strategy categories are hand-assigned, never guessed | `packages/ingest/src/strategy-tags.test.ts` | automated |
| Chamber chain codes are checked against the response | `packages/sources/src/chamber/adapter.test.ts` | automated |
| Chamber fee numerators are basis points | `chamberFundSchema` refine + `chamber/adapter.test.ts` | automated |
| `api` and `mcp` never write | `tools/check-harness.mjs` (`read-only-consumers`) | automated |
| Coverage is required on every published figure | `packages/api/src/openapi.test.ts` asserts the spec marks it required | automated |
| Money never crosses the wire as a JSON number | `packages/api/src/openapi.test.ts` | automated |
| Dead entities are served by default | `packages/api/src/app.test.ts` | automated |
| The benchmark chart charges the same entry cost as the alpha figure | `packages/core/src/rebase.test.ts` + `app.test.ts` | automated |
| A recompute that produces nothing aborts | `evaluateRowBand` in `packages/shared` + `recompute.test.ts` | automated |

The `judgement` and `pending` rows are the honest gaps. When a rule moves from
judgement to automated, move its row and delete the exception.

### Adding a rule

A new rule is not done when it is written here. It is done when a check fails
without it. Add the rule to this file, add its check to `tools/check-harness.mjs`
or a package test, then confirm the check fails when the rule is violated
before you land it.

## Authority note: `ingest`, `backfill` and `compute`

The rule above says database writes are strictly scoped. Three packages touch
the database, and the boundary between them is the append-only line:

- **`ingest`** owns every raw table: `entities`, `entity_snapshots`,
  `depositors`, `benchmark_prices`, `entity_metadata_history`, `ingest_runs`.
  These hold facts we observed once and can never re-observe.
- **`backfill`** must not open its own database handle or issue its own
  writes — it is a thin CLI that calls `runBackfill` in `@vaultbench/ingest`.
- **`compute`** owns every derived table: `entity_flows`, `entity_nav`,
  `entity_metrics`, `metric_definitions`. Every row in them is a pure function
  of the raw tables and is safe to drop and rebuild. `derived-writes-only`
  fails the build if `compute` mutates a raw table.

`scoped-db-writes` allows only `db`, `ingest`, `compute`, `api` and `mcp` to
import database modules. The last two are read surfaces: `read-only-consumers`
fails the build if either mutates any table, raw or derived. A public read
path that *can* write is one bug away from corrupting the archive, and the
archive is the only thing here that cannot be rebuilt.

## Authority note: why derived NAV is not a raw column

`entity_snapshots.value_per_unit` is null for Hyperliquid and OKX, and the
per-unit series lives in `entity_nav` instead. That looks like a duplicate
column and is not: for those venues the per-unit value is *reconstructed* from
account value net of flows, not observed. Writing a derivation back into an
append-only row would mean a fix to the maths silently rewrites history. With
the derivation in its own table, a fix is a `TRUNCATE` and a rerun, and ground
truth is never at risk. `value_per_unit` on a snapshot stays reserved for
venues that genuinely publish one.
