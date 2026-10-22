CREATE TABLE "shipments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"carrier" varchar(20) NOT NULL,
	"delivery_request_id" varchar(40),
	"parcel_id" varchar(40),
	"reference" varchar(40) NOT NULL,
	"locker_id" varchar(40) NOT NULL,
	"compartment_size" integer DEFAULT 2 NOT NULL,
	"payment_mode" varchar(10) DEFAULT 'prepaid' NOT NULL,
	"amount_to_collect_cents" integer DEFAULT 0 NOT NULL,
	"state" varchar(40) DEFAULT 'new' NOT NULL,
	"last_event" varchar(60),
	"last_event_at" timestamp with time zone,
	"last_event_place" varchar(160),
	"checked_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_options" ADD COLUMN "carrier" varchar(20);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "pickup_point" jsonb;--> statement-breakpoint
ALTER TABLE "shipments" ADD CONSTRAINT "shipments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "shipments_parcel_unique" ON "shipments" USING btree ("parcel_id");--> statement-breakpoint
CREATE INDEX "shipments_order_idx" ON "shipments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "shipments_open_idx" ON "shipments" USING btree ("state","checked_at");--> statement-breakpoint
INSERT INTO "delivery_options" ("kind", "name", "description", "price_cents", "free_over_cents", "min_days", "max_days", "countries", "carrier", "position", "is_active")
SELECT 'SHIPPING', '{"en":"BOX NOW locker","el":"Θυρίδα BOX NOW","ru":"Постамат BOX NOW"}'::jsonb, NULL,
       COALESCE((SELECT min("price_cents") FROM "delivery_options" WHERE "kind" = 'SHIPPING' AND "carrier" IS NULL), 0),
       NULL, 1, 3, '["CY"]'::jsonb, 'boxnow',
       COALESCE((SELECT max("position") FROM "delivery_options"), 0) + 1, true
WHERE NOT EXISTS (SELECT 1 FROM "delivery_options" WHERE "carrier" = 'boxnow');
