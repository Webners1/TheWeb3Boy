-- Tier 2 schema: provenance, copy-trading labels, manager stake, pending
-- redemptions, and a dedicated fee_schedule table. Additive only — no
-- existing column is rewritten.
--
-- provenance defaults to 'api' so every row already in the archive keeps
-- the meaning it had: it came from a documented endpoint, not a scrape.
ALTER TABLE "entities" ADD COLUMN "provenance" text DEFAULT 'api' NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "copy_mode" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "positions_visible" boolean;--> statement-breakpoint
ALTER TABLE "entity_snapshots" ADD COLUMN "manager_stake_ratio" numeric(12, 8);--> statement-breakpoint
ALTER TABLE "entity_snapshots" ADD COLUMN "pending_redemptions_usd" numeric(28, 8);--> statement-breakpoint
CREATE TABLE "fee_schedule" (
	"entity_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"management_fee" numeric(6, 4),
	"performance_fee" numeric(6, 4),
	"redemption_period_days" integer,
	"high_water_mark" boolean,
	CONSTRAINT "fee_schedule_entity_id_valid_from_pk" PRIMARY KEY("entity_id","valid_from")
);--> statement-breakpoint
ALTER TABLE "fee_schedule" ADD CONSTRAINT "fee_schedule_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;
