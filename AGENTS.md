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
- Database write operations must be strictly scoped. The `ingest` job is the ONLY package authorized to perform writes. Adapters in `packages/sources` must have zero database imports.

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
| `packages/sources` | Source interface + one adapter per venue. Zero database imports. |
| `packages/ingest` | Daily snapshot job. The only package that writes to the database. |
| `packages/backfill` | One-shot historical loaders. Writes flow through the same guarded path. |
| `packages/shared` | Zod primitives, decimal helpers, logger, storage client. |
| `docs/traps.md` | Known data traps. Update it whenever a new one is discovered. |

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

The `judgement` and `pending` rows are the honest gaps. When a rule moves from
judgement to automated, move its row and delete the exception.

### Adding a rule

A new rule is not done when it is written here. It is done when a check fails
without it. Add the rule to this file, add its check to `tools/check-harness.mjs`
or a package test, then confirm the check fails when the rule is violated
before you land it.

## Authority note: `ingest` vs `backfill`

The rule above says `ingest` is the only package authorized to write. The
repository also has a `backfill` package whose whole job is writing historical
rows. These are reconciled as follows: `backfill` must not open its own
database handle or issue its own writes — it is a thin CLI that calls
`runBackfill` in `@vaultbench/ingest`. `scoped-db-writes` allows only `db`
and `ingest` to import database modules.
