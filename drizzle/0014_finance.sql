CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_type" varchar(20) NOT NULL,
	"owner_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"filename" varchar(200) NOT NULL,
	"content_type" varchar(80) NOT NULL,
	"size" integer NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expense_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(80) NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"expense_date" date NOT NULL,
	"category_id" uuid NOT NULL,
	"payee" varchar(160) NOT NULL,
	"description" varchar(300),
	"reference" varchar(80),
	"vat_treatment" varchar(12) DEFAULT 'DOMESTIC' NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"reverse_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"payment_method" varchar(20),
	"recurring_id" uuid,
	"recurring_month" varchar(7),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"variant_id" uuid,
	"description" varchar(300) NOT NULL,
	"sku" varchar(64),
	"quantity" integer NOT NULL,
	"free_quantity" integer DEFAULT 0 NOT NULL,
	"unit_net_cents" integer NOT NULL,
	"line_net_cents" integer NOT NULL,
	"landed_unit_cents" double precision,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(20) NOT NULL,
	"supplier_id" uuid NOT NULL,
	"supplier_invoice_no" varchar(80),
	"invoice_date" date NOT NULL,
	"status" varchar(12) DEFAULT 'DRAFT' NOT NULL,
	"vat_treatment" varchar(12) NOT NULL,
	"vat_rate_bp" integer DEFAULT 1900 NOT NULL,
	"goods_net_cents" integer DEFAULT 0 NOT NULL,
	"shipping_cents" integer DEFAULT 0 NOT NULL,
	"other_fees_cents" integer DEFAULT 0 NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"reverse_vat_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer DEFAULT 0 NOT NULL,
	"received_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"payment_method" varchar(20),
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"payee" varchar(160) NOT NULL,
	"description" varchar(300),
	"vat_treatment" varchar(12) DEFAULT 'DOMESTIC' NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"payment_method" varchar(20),
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"start_month" varchar(7) NOT NULL,
	"end_month" varchar(7),
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retailers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"contact_name" varchar(120),
	"email" varchar(255),
	"phone" varchar(40),
	"vat_number" varchar(40),
	"tax_id" varchar(40),
	"address" text,
	"country" varchar(2) DEFAULT 'CY' NOT NULL,
	"vat_treatment" varchar(12) DEFAULT 'DOMESTIC' NOT NULL,
	"default_discount_percent" double precision DEFAULT 0 NOT NULL,
	"payment_terms_days" integer DEFAULT 0 NOT NULL,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"kind" varchar(20) NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost_cents" double precision DEFAULT 0 NOT NULL,
	"ref_type" varchar(20),
	"ref_id" uuid,
	"note" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stock_value_snapshots" (
	"month" varchar(7) PRIMARY KEY NOT NULL,
	"value_cents" bigint NOT NULL,
	"units" integer NOT NULL,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"kind" varchar(20) DEFAULT 'manufacturer' NOT NULL,
	"country" varchar(2) DEFAULT 'CY' NOT NULL,
	"vat_number" varchar(40),
	"vat_treatment" varchar(12) DEFAULT 'DOMESTIC' NOT NULL,
	"email" varchar(255),
	"phone" varchar(40),
	"address" text,
	"note" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "variant_costs" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"avg_cost_cents" double precision DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"variant_id" uuid,
	"description" varchar(300) NOT NULL,
	"sku" varchar(64),
	"quantity" integer NOT NULL,
	"unit_net_cents" integer NOT NULL,
	"line_net_cents" integer NOT NULL,
	"unit_cost_cents" double precision DEFAULT 0 NOT NULL,
	"returned_quantity" integer DEFAULT 0 NOT NULL,
	"position" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sale_id" uuid NOT NULL,
	"amount_cents" integer NOT NULL,
	"method" varchar(20) DEFAULT 'bank' NOT NULL,
	"paid_on" date NOT NULL,
	"note" varchar(300),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_prices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"retailer_id" uuid,
	"variant_id" uuid NOT NULL,
	"unit_net_cents" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wholesale_sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"number" varchar(20) NOT NULL,
	"retailer_id" uuid NOT NULL,
	"sale_date" date NOT NULL,
	"due_date" date NOT NULL,
	"vat_treatment" varchar(12) NOT NULL,
	"vat_rate_bp" integer NOT NULL,
	"net_cents" integer NOT NULL,
	"vat_cents" integer NOT NULL,
	"total_cents" integer NOT NULL,
	"cost_cents" integer DEFAULT 0 NOT NULL,
	"note" text,
	"last_reminder_at" timestamp with time zone,
	"reminders_sent" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ALTER COLUMN "order_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "wholesale_sale_id" uuid;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "lines_net" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "due_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "unit_cost_cents" integer;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "finance_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_suppliers_id_fk" FOREIGN KEY ("supplier_id") REFERENCES "public"."suppliers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_expenses" ADD CONSTRAINT "recurring_expenses_category_id_expense_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."expense_categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "variant_costs" ADD CONSTRAINT "variant_costs_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_lines" ADD CONSTRAINT "wholesale_lines_sale_id_wholesale_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."wholesale_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_lines" ADD CONSTRAINT "wholesale_lines_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_payments" ADD CONSTRAINT "wholesale_payments_sale_id_wholesale_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."wholesale_sales"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_prices" ADD CONSTRAINT "wholesale_prices_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_prices" ADD CONSTRAINT "wholesale_prices_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wholesale_sales" ADD CONSTRAINT "wholesale_sales_retailer_id_retailers_id_fk" FOREIGN KEY ("retailer_id") REFERENCES "public"."retailers"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_owner_idx" ON "attachments" USING btree ("owner_type","owner_id");--> statement-breakpoint
CREATE INDEX "expenses_date_idx" ON "expenses" USING btree ("expense_date");--> statement-breakpoint
CREATE INDEX "expenses_category_idx" ON "expenses" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_recurring_month_unique" ON "expenses" USING btree ("recurring_id","recurring_month");--> statement-breakpoint
CREATE INDEX "purchase_lines_purchase_idx" ON "purchase_lines" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "purchase_lines_variant_idx" ON "purchase_lines" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "purchases_number_unique" ON "purchases" USING btree ("number");--> statement-breakpoint
CREATE INDEX "purchases_supplier_idx" ON "purchases" USING btree ("supplier_id");--> statement-breakpoint
CREATE INDEX "purchases_date_idx" ON "purchases" USING btree ("invoice_date");--> statement-breakpoint
CREATE INDEX "retailers_name_idx" ON "retailers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "stock_movements_variant_idx" ON "stock_movements" USING btree ("variant_id");--> statement-breakpoint
CREATE INDEX "stock_movements_when_idx" ON "stock_movements" USING btree ("occurred_at");--> statement-breakpoint
CREATE INDEX "stock_movements_ref_idx" ON "stock_movements" USING btree ("ref_type","ref_id");--> statement-breakpoint
CREATE INDEX "suppliers_name_idx" ON "suppliers" USING btree ("name");--> statement-breakpoint
CREATE INDEX "wholesale_lines_sale_idx" ON "wholesale_lines" USING btree ("sale_id");--> statement-breakpoint
CREATE INDEX "wholesale_payments_sale_idx" ON "wholesale_payments" USING btree ("sale_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_prices_retailer_variant" ON "wholesale_prices" USING btree ("retailer_id","variant_id") WHERE "wholesale_prices"."retailer_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_prices_default_variant" ON "wholesale_prices" USING btree ("variant_id") WHERE "wholesale_prices"."retailer_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "wholesale_sales_number_unique" ON "wholesale_sales" USING btree ("number");--> statement-breakpoint
CREATE INDEX "wholesale_sales_retailer_idx" ON "wholesale_sales" USING btree ("retailer_id");--> statement-breakpoint
CREATE INDEX "wholesale_sales_date_idx" ON "wholesale_sales" USING btree ("sale_date");--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_wholesale_sale_id_wholesale_sales_id_fk" FOREIGN KEY ("wholesale_sale_id") REFERENCES "public"."wholesale_sales"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_one_per_wholesale" ON "invoices" USING btree ("wholesale_sale_id") WHERE "invoices"."kind" = 'INVOICE';--> statement-breakpoint
CREATE INDEX "invoices_wholesale_idx" ON "invoices" USING btree ("wholesale_sale_id");