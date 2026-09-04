CREATE TABLE "entity_metrics" (
	"entity_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"window_days" integer NOT NULL,
	"twr" numeric(20, 10),
	"bench_twr_btc" numeric(20, 10),
	"bench_twr_eth" numeric(20, 10),
	"bench_twr_sol" numeric(20, 10),
	"alpha_btc" numeric(20, 10),
	"alpha_eth" numeric(20, 10),
	"alpha_sol" numeric(20, 10),
	"max_drawdown" numeric(20, 10),
	"volatility" numeric(20, 10),
	"follower_median_return" numeric(20, 10),
	"follower_gap" numeric(20, 10),
	"days_covered" integer NOT NULL,
	"is_full_window" boolean NOT NULL,
	"sampling" text NOT NULL,
	"nav_quality" text,
	"headline_eligible" boolean NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entity_metrics_entity_id_as_of_window_days_pk" PRIMARY KEY("entity_id","as_of","window_days")
);
--> statement-breakpoint
CREATE TABLE "entity_nav" (
	"entity_id" uuid NOT NULL,
	"as_of" date NOT NULL,
	"value_per_unit" numeric(38, 18) NOT NULL,
	"nav_quality" text NOT NULL,
	"method" text NOT NULL,
	"sampling" text NOT NULL,
	"computed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "entity_nav_entity_id_as_of_pk" PRIMARY KEY("entity_id","as_of")
);
--> statement-breakpoint
ALTER TABLE "entity_flows" ADD COLUMN "computed_at" timestamp with time zone NOT NULL;--> statement-breakpoint
ALTER TABLE "entity_metrics" ADD CONSTRAINT "entity_metrics_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_nav" ADD CONSTRAINT "entity_nav_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entity_metrics_entity_id_window_days_idx" ON "entity_metrics" USING btree ("entity_id","window_days");--> statement-breakpoint
CREATE INDEX "entity_nav_as_of_idx" ON "entity_nav" USING brin ("as_of");