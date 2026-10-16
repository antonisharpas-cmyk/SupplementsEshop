ALTER TABLE "orders" ADD COLUMN "channel" varchar(12) DEFAULT 'web' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "created_by" uuid;