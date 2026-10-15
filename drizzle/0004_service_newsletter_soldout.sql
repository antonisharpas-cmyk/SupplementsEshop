CREATE TYPE "public"."product_availability" AS ENUM('AVAILABLE', 'SOLD_OUT');--> statement-breakpoint
CREATE TYPE "public"."subscriber_status" AS ENUM('PENDING', 'SUBSCRIBED', 'UNSUBSCRIBED');--> statement-breakpoint
CREATE TYPE "public"."support_close_reason" AS ENUM('STAFF', 'INACTIVITY');--> statement-breakpoint
CREATE TYPE "public"."support_sender" AS ENUM('CUSTOMER', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."support_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
ALTER TYPE "public"."homepage_section_key" ADD VALUE 'newsletter';--> statement-breakpoint
CREATE TABLE "email_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(40) NOT NULL,
	"category" varchar(16) NOT NULL,
	"to_email" varchar(255) NOT NULL,
	"subject" varchar(300) NOT NULL,
	"status" varchar(16) NOT NULL,
	"error" text,
	"body" text,
	"related_id" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "newsletter_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" varchar(40) NOT NULL,
	"subject" varchar(200) NOT NULL,
	"created_by" uuid,
	"recipient_count" integer DEFAULT 0 NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"status" varchar(16) DEFAULT 'SENDING' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "newsletter_subscribers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"first_name" varchar(80),
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"status" "subscriber_status" DEFAULT 'PENDING' NOT NULL,
	"source" varchar(40) NOT NULL,
	"user_id" uuid,
	"consent_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"unsubscribed_at" timestamp with time zone,
	"last_confirmation_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"guest_token_hash" varchar(64),
	"name" varchar(120),
	"email" varchar(255),
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"page_url" varchar(500),
	"status" "support_status" DEFAULT 'OPEN' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	"closed_reason" "support_close_reason",
	"closed_by" uuid,
	"staff_last_read_at" timestamp with time zone,
	"customer_last_read_at" timestamp with time zone,
	"notified_at" timestamp with time zone,
	"transcript_sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender" "support_sender" NOT NULL,
	"staff_user_id" uuid,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "availability" "product_availability" DEFAULT 'AVAILABLE' NOT NULL;--> statement-breakpoint
ALTER TABLE "newsletter_campaigns" ADD CONSTRAINT "newsletter_campaigns_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "newsletter_subscribers" ADD CONSTRAINT "newsletter_subscribers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_conversations" ADD CONSTRAINT "support_conversations_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_conversation_id_support_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."support_conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "email_log_created_idx" ON "email_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "email_log_related_idx" ON "email_log" USING btree ("related_id");--> statement-breakpoint
CREATE UNIQUE INDEX "newsletter_email_unique" ON "newsletter_subscribers" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "newsletter_status_idx" ON "newsletter_subscribers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_status_activity_idx" ON "support_conversations" USING btree ("status","last_activity_at");--> statement-breakpoint
CREATE INDEX "support_user_idx" ON "support_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "support_guest_idx" ON "support_conversations" USING btree ("guest_token_hash");--> statement-breakpoint
CREATE INDEX "support_messages_conversation_idx" ON "support_messages" USING btree ("conversation_id","created_at");