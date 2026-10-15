CREATE TYPE "public"."homepage_section_key" AS ENUM('categories', 'trending', 'new_in', 'on_sale');--> statement-breakpoint
CREATE TYPE "public"."homepage_section_mode" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TABLE "homepage_section_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"section_key" "homepage_section_key" NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"position" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "homepage_sections" (
	"key" "homepage_section_key" PRIMARY KEY NOT NULL,
	"position" integer NOT NULL,
	"is_visible" boolean DEFAULT true NOT NULL,
	"mode" "homepage_section_mode" DEFAULT 'auto' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "homepage_section_items" ADD CONSTRAINT "homepage_section_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "homepage_section_items" ADD CONSTRAINT "homepage_section_items_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "homepage_items_section_position_idx" ON "homepage_section_items" USING btree ("section_key","position");--> statement-breakpoint
CREATE UNIQUE INDEX "homepage_items_section_product_uq" ON "homepage_section_items" USING btree ("section_key","product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "homepage_items_section_category_uq" ON "homepage_section_items" USING btree ("section_key","category_id");