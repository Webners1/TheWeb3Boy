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
