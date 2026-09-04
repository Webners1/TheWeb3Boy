-- entity_metrics gains beta and r-squared against each benchmark.
--
-- Nullable, unlike fees_applied: beta is genuinely undefined for an entity
-- with fewer than three paired return intervals, or against a benchmark that
-- did not move over the window. A zero there would assert "this entity is
-- market-neutral", which is a different claim from "we cannot say".
--
-- No TRUNCATE needed. Existing rows keep their alpha and simply carry a null
-- beta until the next `pnpm recompute` fills them in.
ALTER TABLE "entity_metrics" ADD COLUMN "beta_btc" numeric;--> statement-breakpoint
ALTER TABLE "entity_metrics" ADD COLUMN "beta_eth" numeric;--> statement-breakpoint
ALTER TABLE "entity_metrics" ADD COLUMN "beta_sol" numeric;--> statement-breakpoint
ALTER TABLE "entity_metrics" ADD COLUMN "r_squared_btc" numeric;--> statement-breakpoint
ALTER TABLE "entity_metrics" ADD COLUMN "r_squared_eth" numeric;--> statement-breakpoint
ALTER TABLE "entity_metrics" ADD COLUMN "r_squared_sol" numeric;
