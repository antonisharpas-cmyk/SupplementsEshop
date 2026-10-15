CREATE TYPE "public"."contact_status" AS ENUM('NEW', 'IN_PROGRESS', 'RESOLVED');--> statement-breakpoint
CREATE TYPE "public"."delivery_kind" AS ENUM('PICKUP', 'SHIPPING');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('PERCENTAGE', 'FIXED');--> statement-breakpoint
CREATE TYPE "public"."enquiry_topic" AS ENUM('EXISTING_ORDER', 'DELIVERY', 'PAYMENT', 'PRODUCT', 'RETURN_REFUND', 'GENERAL', 'OTHER');--> statement-breakpoint
CREATE TYPE "public"."order_status" AS ENUM('PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."otp_purpose" AS ENUM('REGISTRATION', 'PASSWORD_RESET', 'EMAIL_CHANGE');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('PENDING', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'REFUNDED', 'PARTIALLY_REFUNDED');--> statement-breakpoint
CREATE TYPE "public"."promotion_scope" AS ENUM('PRODUCT', 'CATEGORY', 'SUBCATEGORY', 'ALL');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('ACTIVE', 'CONSUMED', 'RELEASED');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('CUSTOMER', 'ADMIN', 'SUPER_ADMIN');--> statement-breakpoint
CREATE TABLE "addresses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" varchar(60),
	"recipient_name" varchar(160) NOT NULL,
	"phone" varchar(32) NOT NULL,
	"line1" varchar(200) NOT NULL,
	"line2" varchar(200),
	"city" varchar(100) NOT NULL,
	"postal_code" varchar(20) NOT NULL,
	"country" varchar(2) DEFAULT 'CY' NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"actor_email" varchar(255),
	"action" varchar(80) NOT NULL,
	"entity" varchar(60) NOT NULL,
	"entity_id" varchar(64),
	"diff" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cart_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cart_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "carts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"anonymous_token" varchar(64),
	"applied_promo_code_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"parent_id" uuid,
	"slug" varchar(120) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"seo_title" jsonb,
	"seo_description" jsonb,
	"image_url" text,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"topic" "enquiry_topic" NOT NULL,
	"order_number" varchar(20),
	"subject" varchar(200) NOT NULL,
	"message" text NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32),
	"user_id" uuid,
	"status" "contact_status" DEFAULT 'NEW' NOT NULL,
	"admin_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "delivery_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" "delivery_kind" NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"price_cents" integer DEFAULT 0 NOT NULL,
	"free_over_cents" integer,
	"min_days" integer,
	"max_days" integer,
	"countries" jsonb,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hero_banners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" jsonb NOT NULL,
	"subtitle" jsonb,
	"image_url" text,
	"mobile_image_url" text,
	"video_url" text,
	"primary_cta_label" jsonb,
	"primary_cta_href" varchar(300),
	"secondary_cta_label" jsonb,
	"secondary_cta_href" varchar(300),
	"text_align" varchar(10) DEFAULT 'left' NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"starts_at" timestamp with time zone,
	"ends_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory" (
	"variant_id" uuid PRIMARY KEY NOT NULL,
	"on_hand" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"low_stock_threshold" integer DEFAULT 3 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "inventory_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"variant_id" uuid NOT NULL,
	"cart_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"status" "reservation_status" DEFAULT 'ACTIVE' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"released_at" timestamp with time zone,
	"consumed_at" timestamp with time zone,
	"order_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "marketing_consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"user_id" uuid,
	"granted" boolean NOT NULL,
	"source" varchar(40) NOT NULL,
	"ip_hash" varchar(64),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"variant_id" uuid,
	"product_id" uuid,
	"product_name" varchar(300) NOT NULL,
	"sku" varchar(64) NOT NULL,
	"size" varchar(24),
	"color_name" varchar(80),
	"image_url" text,
	"quantity" integer NOT NULL,
	"unit_price_cents" integer NOT NULL,
	"unit_discount_cents" integer DEFAULT 0 NOT NULL,
	"line_total_cents" integer NOT NULL,
	"applied_promotion_id" uuid,
	"applied_promotion_snapshot" jsonb
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_number" varchar(20) NOT NULL,
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32) NOT NULL,
	"customer_name" varchar(160) NOT NULL,
	"status" "order_status" DEFAULT 'PENDING' NOT NULL,
	"delivery_kind" "delivery_kind" NOT NULL,
	"delivery_option_id" uuid,
	"delivery_option_name" jsonb,
	"shipping_address" jsonb,
	"billing_address" jsonb,
	"subtotal_cents" integer NOT NULL,
	"promotion_discount_cents" integer DEFAULT 0 NOT NULL,
	"promo_code_discount_cents" integer DEFAULT 0 NOT NULL,
	"delivery_cents" integer DEFAULT 0 NOT NULL,
	"total_cents" integer NOT NULL,
	"vat_cents" integer DEFAULT 0 NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"promo_code_id" uuid,
	"promo_code_snapshot" jsonb,
	"customer_note" text,
	"admin_note" text,
	"locale" varchar(5) DEFAULT 'en' NOT NULL,
	"estimated_delivery_from" timestamp with time zone,
	"estimated_delivery_to" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"shipped_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"purpose" "otp_purpose" NOT NULL,
	"code_hash" varchar(64) NOT NULL,
	"pending_payload" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" varchar(30) DEFAULT 'stripe' NOT NULL,
	"provider_payment_id" varchar(120),
	"provider_session_id" varchar(120),
	"status" "payment_status" DEFAULT 'PENDING' NOT NULL,
	"amount_cents" integer NOT NULL,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"card_brand" varchar(30),
	"card_last4" varchar(4),
	"failure_code" varchar(80),
	"failure_message" text,
	"refunded_cents" integer DEFAULT 0 NOT NULL,
	"paid_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"url" text NOT NULL,
	"alt" jsonb,
	"width" integer,
	"height" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"sku" varchar(64) NOT NULL,
	"size" varchar(24) NOT NULL,
	"color_name" jsonb,
	"color_hex" varchar(7),
	"price_cents_override" integer,
	"sale_price_cents_override" integer,
	"position" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_views" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"user_id" uuid,
	"anonymous_token" varchar(64),
	"viewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"slug" varchar(160) NOT NULL,
	"name" jsonb NOT NULL,
	"description" jsonb,
	"summary" jsonb,
	"seo_title" jsonb,
	"seo_description" jsonb,
	"price_cents" integer NOT NULL,
	"sale_price_cents" integer,
	"currency" varchar(3) DEFAULT 'EUR' NOT NULL,
	"size_guide" jsonb,
	"search_text" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_code_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"promo_code_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"user_id" uuid,
	"email" varchar(255) NOT NULL,
	"discount_cents" integer NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promo_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" varchar(40) NOT NULL,
	"discount_type" "discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"min_order_cents" integer DEFAULT 0 NOT NULL,
	"max_uses" integer,
	"max_uses_per_user" integer DEFAULT 1,
	"times_used" integer DEFAULT 0 NOT NULL,
	"product_ids" jsonb,
	"category_ids" jsonb,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "promotions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(160) NOT NULL,
	"scope" "promotion_scope" NOT NULL,
	"product_id" uuid,
	"category_id" uuid,
	"discount_type" "discount_type" NOT NULL,
	"discount_value" integer NOT NULL,
	"badge_text" jsonb,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"priority" integer DEFAULT 0 NOT NULL,
	"show_on_homepage" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"user_agent" varchar(400),
	"ip_hash" varchar(64),
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(80) PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"description" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar(255) NOT NULL,
	"phone" varchar(32) NOT NULL,
	"password_hash" text NOT NULL,
	"first_name" varchar(80) NOT NULL,
	"last_name" varchar(80) NOT NULL,
	"role" "user_role" DEFAULT 'CUSTOMER' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" varchar(120) PRIMARY KEY NOT NULL,
	"provider" varchar(30) DEFAULT 'stripe' NOT NULL,
	"type" varchar(120) NOT NULL,
	"payload" jsonb,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wishlist_items" (
	"wishlist_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"variant_id" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wishlist_items_wishlist_id_product_id_pk" PRIMARY KEY("wishlist_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "wishlists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_items" ADD CONSTRAINT "cart_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "carts" ADD CONSTRAINT "carts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_reservations" ADD CONSTRAINT "inventory_reservations_cart_id_carts_id_fk" FOREIGN KEY ("cart_id") REFERENCES "public"."carts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_consents" ADD CONSTRAINT "marketing_consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_images" ADD CONSTRAINT "product_images_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_views" ADD CONSTRAINT "product_views_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_views" ADD CONSTRAINT "product_views_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_usage" ADD CONSTRAINT "promo_code_usage_promo_code_id_promo_codes_id_fk" FOREIGN KEY ("promo_code_id") REFERENCES "public"."promo_codes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_usage" ADD CONSTRAINT "promo_code_usage_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promo_code_usage" ADD CONSTRAINT "promo_code_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotions" ADD CONSTRAINT "promotions_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_wishlist_id_wishlists_id_fk" FOREIGN KEY ("wishlist_id") REFERENCES "public"."wishlists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlist_items" ADD CONSTRAINT "wishlist_items_variant_id_product_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."product_variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wishlists" ADD CONSTRAINT "wishlists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "addresses_user_idx" ON "addresses" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "addresses_one_default_per_user" ON "addresses" USING btree ("user_id") WHERE "addresses"."is_default" = true;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_log" USING btree ("entity","entity_id");--> statement-breakpoint
CREATE INDEX "audit_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cart_items_cart_variant_unique" ON "cart_items" USING btree ("cart_id","variant_id");--> statement-breakpoint
CREATE INDEX "cart_items_cart_idx" ON "cart_items" USING btree ("cart_id");--> statement-breakpoint
CREATE UNIQUE INDEX "carts_anonymous_token_unique" ON "carts" USING btree ("anonymous_token");--> statement-breakpoint
CREATE INDEX "carts_user_idx" ON "carts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "carts_updated_idx" ON "carts" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_slug_per_parent" ON "categories" USING btree ("parent_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_root_slug" ON "categories" USING btree ("slug") WHERE "categories"."parent_id" is null;--> statement-breakpoint
CREATE INDEX "categories_parent_position_idx" ON "categories" USING btree ("parent_id","position");--> statement-breakpoint
CREATE INDEX "contact_status_idx" ON "contact_requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "contact_created_idx" ON "contact_requests" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "delivery_options_active_idx" ON "delivery_options" USING btree ("is_active","position");--> statement-breakpoint
CREATE INDEX "hero_active_window_idx" ON "hero_banners" USING btree ("is_active","starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "inventory_low_stock_idx" ON "inventory" USING btree ("on_hand","reserved");--> statement-breakpoint
CREATE INDEX "reservations_active_expiry_idx" ON "inventory_reservations" USING btree ("expires_at") WHERE "inventory_reservations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "reservations_cart_idx" ON "inventory_reservations" USING btree ("cart_id");--> statement-breakpoint
CREATE INDEX "reservations_variant_idx" ON "inventory_reservations" USING btree ("variant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservations_one_active_per_cart_variant" ON "inventory_reservations" USING btree ("cart_id","variant_id") WHERE "inventory_reservations"."status" = 'ACTIVE';--> statement-breakpoint
CREATE INDEX "marketing_email_idx" ON "marketing_consents" USING btree (lower("email"),"created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "orders_number_unique" ON "orders" USING btree ("order_number");--> statement-breakpoint
CREATE INDEX "orders_user_idx" ON "orders" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "orders_status_idx" ON "orders" USING btree ("status");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "orders_number_email_idx" ON "orders" USING btree ("order_number",lower("email"));--> statement-breakpoint
CREATE INDEX "otp_email_purpose_idx" ON "otp_codes" USING btree (lower("email"),"purpose");--> statement-breakpoint
CREATE INDEX "otp_expires_idx" ON "otp_codes" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_payment_unique" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "product_images_product_position_idx" ON "product_images" USING btree ("product_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_sku_unique" ON "product_variants" USING btree ("sku");--> statement-breakpoint
CREATE UNIQUE INDEX "variants_product_size_color" ON "product_variants" USING btree ("product_id","size","color_hex");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "product_views_user_idx" ON "product_views" USING btree ("user_id","viewed_at");--> statement-breakpoint
CREATE INDEX "product_views_anon_idx" ON "product_views" USING btree ("anonymous_token","viewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "products_slug_unique" ON "products" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_active_idx" ON "products" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "products_price_idx" ON "products" USING btree ("price_cents");--> statement-breakpoint
CREATE INDEX "products_created_idx" ON "products" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promo_usage_order_unique" ON "promo_code_usage" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "promo_usage_code_idx" ON "promo_code_usage" USING btree ("promo_code_id");--> statement-breakpoint
CREATE INDEX "promo_usage_email_idx" ON "promo_code_usage" USING btree ("promo_code_id",lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "promo_codes_code_unique" ON "promo_codes" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "promo_codes_active_idx" ON "promo_codes" USING btree ("is_active","expires_at");--> statement-breakpoint
CREATE INDEX "promotions_window_idx" ON "promotions" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "promotions_active_idx" ON "promotions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "promotions_product_idx" ON "promotions" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "promotions_category_idx" ON "promotions" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_unique" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expires_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_unique" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "webhook_events_type_idx" ON "webhook_events" USING btree ("type");--> statement-breakpoint
CREATE INDEX "wishlist_items_product_idx" ON "wishlist_items" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wishlists_user_unique" ON "wishlists" USING btree ("user_id");