-- entity_metrics gains fees_applied, which every row must carry.
--
-- Truncated rather than back-filled with a default. A default of `false` on
-- existing rows would assert "no fee haircut was applied to this figure" for
-- rows where we do not know that, and a fabricated fee flag is worse than no
-- row at all. entity_metrics is derived and disposable by design — the next
-- `pnpm recompute` rebuilds every row with a real value.
TRUNCATE TABLE "entity_metrics";--> statement-breakpoint
ALTER TABLE "entity_metrics" ADD COLUMN "fees_applied" boolean NOT NULL;
