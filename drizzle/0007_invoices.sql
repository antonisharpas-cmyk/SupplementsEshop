CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(32) NOT NULL,
	"kind" varchar(12) NOT NULL,
	"order_id" uuid NOT NULL,
	"order_number" varchar(20) NOT NULL,
	"relates_to_id" uuid,
	"issued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"payment_method" varchar(20) NOT NULL,
	"customer" jsonb NOT NULL,
	"seller" jsonb NOT NULL,
	"lines" jsonb NOT NULL,
	"note" text
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unique" ON "invoices" USING btree ("number");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_per_order" ON "invoices" USING btree ("order_id") WHERE "invoices"."kind" = 'INVOICE';--> statement-breakpoint
CREATE INDEX "invoices_issued_idx" ON "invoices" USING btree ("issued_at");--> statement-breakpoint
CREATE INDEX "invoices_order_idx" ON "invoices" USING btree ("order_id");
--> statement-breakpoint
UPDATE "hero_banners" SET "title" = '{"en":"Fuel your performance","el":"Δύναμη σε κάθε προπόνηση","ru":"Энергия для результата"}'::jsonb WHERE "title"->>'en' = 'FUEL YOUR PERFORMANCE';
