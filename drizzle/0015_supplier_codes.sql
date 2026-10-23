ALTER TABLE "product_variants" ADD COLUMN "supplier_code" varchar(64);--> statement-breakpoint
CREATE INDEX "variants_supplier_code_idx" ON "product_variants" USING btree ("supplier_code");