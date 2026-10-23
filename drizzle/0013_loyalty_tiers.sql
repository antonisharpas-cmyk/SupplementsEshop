CREATE TABLE "tier_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"from_tier" varchar(20),
	"to_tier" varchar(20) NOT NULL,
	"reason" varchar(20) NOT NULL,
	"note" text,
	"by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tier" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tier_discount_cents" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier" varchar(20) DEFAULT 'basic' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier_since" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier_manual_until" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "tier_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "tier_events" ADD CONSTRAINT "tier_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tier_events_user_idx" ON "tier_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "users_tier_expires_idx" ON "users" USING btree ("tier_expires_at");