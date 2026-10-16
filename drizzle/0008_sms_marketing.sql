CREATE TABLE "sms_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"audience" varchar(8) DEFAULT 'all' NOT NULL,
	"sender_id" varchar(20) NOT NULL,
	"segments" integer DEFAULT 1 NOT NULL,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'SENDING' NOT NULL,
	"provider_refs" jsonb,
	"error" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "sms_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"phone" varchar(20) NOT NULL,
	"user_id" uuid,
	"first_name" varchar(80),
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"status" varchar(16) DEFAULT 'SUBSCRIBED' NOT NULL,
	"source" varchar(40) NOT NULL,
	"consent_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sms_campaigns" ADD CONSTRAINT "sms_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sms_subscribers" ADD CONSTRAINT "sms_subscribers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sms_subscribers_phone_unique" ON "sms_subscribers" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "sms_subscribers_status_idx" ON "sms_subscribers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sms_subscribers_user_idx" ON "sms_subscribers" USING btree ("user_id");