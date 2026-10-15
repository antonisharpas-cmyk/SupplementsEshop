CREATE TABLE "media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_type" varchar(60) NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size" integer NOT NULL,
	"filename" varchar(200),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" varchar(20) DEFAULT 'card' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_number" varchar(80);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "tracking_url" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "access_token" varchar(64);--> statement-breakpoint
UPDATE "settings" SET "value" = '"AX"'::jsonb WHERE "key" = 'order_number_prefix' AND "value" = '"SF"'::jsonb;
