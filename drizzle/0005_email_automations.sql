CREATE TYPE "public"."email_job_status" AS ENUM('SCHEDULED', 'SENT', 'SKIPPED', 'CANCELLED', 'FAILED');--> statement-breakpoint
CREATE TABLE "email_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation" varchar(60) NOT NULL,
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"recipient_name" varchar(160),
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" varchar(160),
	"status" "email_job_status" DEFAULT 'SCHEDULED' NOT NULL,
	"triggered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"scheduled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"reason" text,
	"outcome" text,
	"subject" varchar(300),
	"email_log_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "email_templates" (
	"key" varchar(60) PRIMARY KEY NOT NULL,
	"enabled" boolean,
	"delay_minutes" integer,
	"content" jsonb,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"notified_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD COLUMN "skipped_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD COLUMN "content" jsonb;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD COLUMN "scheduled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "support_messages" ADD COLUMN "automated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locale" varchar(5) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "email_jobs" ADD CONSTRAINT "email_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_templates" ADD CONSTRAINT "email_templates_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_alerts" ADD CONSTRAINT "stock_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "email_jobs_dedupe_unique" ON "email_jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "email_jobs_due_idx" ON "email_jobs" USING btree ("status","scheduled_at");--> statement-breakpoint
CREATE INDEX "email_jobs_user_idx" ON "email_jobs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "email_jobs_created_idx" ON "email_jobs" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stock_alerts_variant_email_unique" ON "stock_alerts" USING btree ("variant_id",lower("email"));--> statement-breakpoint
CREATE INDEX "stock_alerts_pending_idx" ON "stock_alerts" USING btree ("variant_id","notified_at");--> statement-breakpoint
CREATE INDEX "email_log_to_idx" ON "email_log" USING btree (lower("to_email"),"created_at");