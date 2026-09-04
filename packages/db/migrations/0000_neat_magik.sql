CREATE TABLE "benchmark_prices" (
	"symbol" text NOT NULL,
	"as_of" date NOT NULL,
	"close_usd" numeric(20, 8) NOT NULL,
	"source" text DEFAULT 'defillama' NOT NULL,
	CONSTRAINT "benchmark_prices_symbol_as_of_pk" PRIMARY KEY("symbol","as_of")
);
--> statement-breakpoint
CREATE TABLE "depositors" (
	"entity_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"depositor" text NOT NULL,
	"equity" numeric(28, 8),
	"pnl" numeric(28, 8),
	"all_time_pnl" numeric(28, 8),
	"days_following" integer,
	"entry_time" timestamp with time zone,
	"lockup_until" timestamp with time zone,
	CONSTRAINT "depositors_entity_id_as_of_depositor_pk" PRIMARY KEY("entity_id","as_of","depositor")
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"venue" text NOT NULL,
	"venue_type" text NOT NULL,
	"market_type" text NOT NULL,
	"strategy_category" text,
	"base_currency" text NOT NULL,
	"inception_date" date,
	"parent_entity_id" uuid,
	"status" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_flows" (
	"entity_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"net_flow_usd" numeric(28, 8),
	CONSTRAINT "entity_flows_entity_id_as_of_pk" PRIMARY KEY("entity_id","as_of")
);
--> statement-breakpoint
CREATE TABLE "entity_metadata_history" (
	"entity_id" uuid NOT NULL,
	"valid_from" date NOT NULL,
	"valid_to" date,
	"name" text,
	"strategy_category" text,
	"fee_profit_share" numeric(6, 4),
	"fee_management" numeric(6, 4),
	"leader_commission" numeric(6, 4),
	"status" text,
	CONSTRAINT "entity_metadata_history_entity_id_valid_from_pk" PRIMARY KEY("entity_id","valid_from")
);
--> statement-breakpoint
CREATE TABLE "entity_snapshots" (
	"entity_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"value_per_unit" numeric(38, 18),
	"account_value" numeric(28, 8),
	"cum_pnl" numeric(28, 8),
	"aum_usd" numeric(20, 2),
	"sampling" text NOT NULL,
	"nav_quality" text NOT NULL,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_ref" text,
	CONSTRAINT "entity_snapshots_entity_id_as_of_pk" PRIMARY KEY("entity_id","as_of")
);
--> statement-breakpoint
CREATE TABLE "ingest_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"status" text NOT NULL,
	"rows_written" integer,
	"rows_expected" integer,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "metric_definitions" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text,
	"description" text,
	"unit" text,
	"direction" text,
	"caveats" text
);
--> statement-breakpoint
ALTER TABLE "depositors" ADD CONSTRAINT "depositors_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_parent_entity_id_entities_id_fk" FOREIGN KEY ("parent_entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_flows" ADD CONSTRAINT "entity_flows_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_metadata_history" ADD CONSTRAINT "entity_metadata_history_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_snapshots" ADD CONSTRAINT "entity_snapshots_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "depositors_entity_id_as_of_idx" ON "depositors" USING btree ("entity_id","as_of");--> statement-breakpoint
CREATE UNIQUE INDEX "entities_source_external_id_key" ON "entities" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "entities_source_status_idx" ON "entities" USING btree ("source","status");--> statement-breakpoint
CREATE INDEX "entity_snapshots_as_of_idx" ON "entity_snapshots" USING brin ("as_of");