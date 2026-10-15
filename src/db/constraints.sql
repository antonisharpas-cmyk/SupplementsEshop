-- ============================================================================
-- INVARIANTS ENFORCED BY POSTGRES
--
-- Everything here is a rule that must hold even if the application has a bug,
-- a migration is half-applied, or someone runs an UPDATE by hand at 2am.
-- Drizzle's schema builder can't express most of it, so it lives as SQL and is
-- applied after every migration by `npm run db:push`.
--
-- The rule of thumb: if violating it would cost money or oversell stock, it
-- belongs in this file and not only in TypeScript.
-- ============================================================================

-- ---------------------------------------------------------------- inventory --
-- Business rule 6: stock must never become negative. Three constraints, because
-- there are three distinct ways to get it wrong.

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_on_hand_non_negative;
ALTER TABLE inventory ADD CONSTRAINT inventory_on_hand_non_negative
  CHECK (on_hand >= 0);

ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_reserved_non_negative;
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_non_negative
  CHECK (reserved >= 0);

-- The important one. You cannot promise more stock than physically exists,
-- so "available" can never go below zero either. An overselling bug becomes a
-- loud transaction failure instead of a quiet oversell.
ALTER TABLE inventory DROP CONSTRAINT IF EXISTS inventory_reserved_within_on_hand;
ALTER TABLE inventory ADD CONSTRAINT inventory_reserved_within_on_hand
  CHECK (reserved <= on_hand);

-- Available stock as a generated column: one definition, used by the
-- storefront, the admin panel and the reservation logic alike. No caller can
-- compute it a different way.
ALTER TABLE inventory DROP COLUMN IF EXISTS available;
ALTER TABLE inventory ADD COLUMN available INTEGER
  GENERATED ALWAYS AS (on_hand - reserved) STORED;

CREATE INDEX IF NOT EXISTS inventory_available_idx ON inventory (available);

-- Reservations must be for a real quantity.
ALTER TABLE inventory_reservations DROP CONSTRAINT IF EXISTS reservations_quantity_positive;
ALTER TABLE inventory_reservations ADD CONSTRAINT reservations_quantity_positive
  CHECK (quantity > 0);

-- A reservation that is no longer ACTIVE must say when it stopped being active,
-- so the expiry sweep and the admin inventory view can never disagree.
ALTER TABLE inventory_reservations DROP CONSTRAINT IF EXISTS reservations_terminal_timestamped;
ALTER TABLE inventory_reservations ADD CONSTRAINT reservations_terminal_timestamped
  CHECK (
    (status = 'ACTIVE'   AND released_at IS NULL AND consumed_at IS NULL) OR
    (status = 'RELEASED' AND released_at IS NOT NULL) OR
    (status = 'CONSUMED' AND consumed_at IS NOT NULL)
  );

-- ------------------------------------------------------------------- money --
-- Prices are integer cents and are never negative. A discount is expressed as
-- a separate positive discount amount, never as a negative price.

ALTER TABLE products DROP CONSTRAINT IF EXISTS products_price_non_negative;
ALTER TABLE products ADD CONSTRAINT products_price_non_negative
  CHECK (price_cents >= 0 AND (sale_price_cents IS NULL OR sale_price_cents >= 0));

-- A "sale" price above the normal price is a data-entry mistake that would
-- show the customer a negative discount.
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_sale_below_price;
ALTER TABLE products ADD CONSTRAINT products_sale_below_price
  CHECK (sale_price_cents IS NULL OR sale_price_cents <= price_cents);

ALTER TABLE product_variants DROP CONSTRAINT IF EXISTS variants_price_non_negative;
ALTER TABLE product_variants ADD CONSTRAINT variants_price_non_negative
  CHECK (
    (price_cents_override IS NULL OR price_cents_override >= 0) AND
    (sale_price_cents_override IS NULL OR sale_price_cents_override >= 0)
  );

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_amounts_non_negative;
ALTER TABLE orders ADD CONSTRAINT orders_amounts_non_negative
  CHECK (
    subtotal_cents >= 0 AND
    promotion_discount_cents >= 0 AND
    promo_code_discount_cents >= 0 AND
    delivery_cents >= 0 AND
    total_cents >= 0 AND
    vat_cents >= 0
  );

-- The order total must actually be the sum of its parts. This is the line that
-- catches a pricing bug before Stripe charges the wrong amount.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_total_is_consistent;
ALTER TABLE orders ADD CONSTRAINT orders_total_is_consistent
  CHECK (
    total_cents =
      subtotal_cents
      - promotion_discount_cents
      - promo_code_discount_cents
      + delivery_cents
  );

-- Discounts can never exceed what is being discounted.
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_discount_within_subtotal;
ALTER TABLE orders ADD CONSTRAINT orders_discount_within_subtotal
  CHECK (promotion_discount_cents + promo_code_discount_cents <= subtotal_cents);

ALTER TABLE order_items DROP CONSTRAINT IF EXISTS order_items_sane;
ALTER TABLE order_items ADD CONSTRAINT order_items_sane
  CHECK (
    quantity > 0 AND
    unit_price_cents >= 0 AND
    unit_discount_cents >= 0 AND
    unit_discount_cents <= unit_price_cents AND
    line_total_cents = (unit_price_cents - unit_discount_cents) * quantity
  );

ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amounts_sane;
ALTER TABLE payments ADD CONSTRAINT payments_amounts_sane
  CHECK (amount_cents >= 0 AND refunded_cents >= 0 AND refunded_cents <= amount_cents);

-- --------------------------------------------------------------- cart rules --

ALTER TABLE cart_items DROP CONSTRAINT IF EXISTS cart_items_quantity_positive;
ALTER TABLE cart_items ADD CONSTRAINT cart_items_quantity_positive
  CHECK (quantity > 0 AND quantity <= 20);

-- A cart belongs to a logged-in user or to an anonymous token. Never neither,
-- or it is unreachable and holds stock forever.
ALTER TABLE carts DROP CONSTRAINT IF EXISTS carts_has_an_owner;
ALTER TABLE carts ADD CONSTRAINT carts_has_an_owner
  CHECK (user_id IS NOT NULL OR anonymous_token IS NOT NULL);

-- -------------------------------------------------------------- promotions --

-- `scope` and the populated foreign key must agree, otherwise a promotion
-- silently applies to nothing or to everything.
ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_scope_matches_target;
ALTER TABLE promotions ADD CONSTRAINT promotions_scope_matches_target
  CHECK (
    (scope = 'PRODUCT'     AND product_id IS NOT NULL AND category_id IS NULL) OR
    (scope IN ('CATEGORY','SUBCATEGORY') AND category_id IS NOT NULL AND product_id IS NULL) OR
    (scope = 'ALL'         AND product_id IS NULL AND category_id IS NULL)
  );

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_discount_sane;
ALTER TABLE promotions ADD CONSTRAINT promotions_discount_sane
  CHECK (
    discount_value > 0 AND
    (discount_type <> 'PERCENTAGE' OR discount_value <= 100)
  );

ALTER TABLE promotions DROP CONSTRAINT IF EXISTS promotions_window_ordered;
ALTER TABLE promotions ADD CONSTRAINT promotions_window_ordered
  CHECK (ends_at IS NULL OR ends_at > starts_at);

ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_discount_sane;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_discount_sane
  CHECK (
    discount_value > 0 AND
    (discount_type <> 'PERCENTAGE' OR discount_value <= 100) AND
    min_order_cents >= 0
  );

-- Business rule 12: usage limits are real. The counter is incremented inside
-- the checkout transaction, so this constraint is what stops the 101st use of
-- a 100-use code even under simultaneous checkouts.
ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_within_max_uses;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_within_max_uses
  CHECK (max_uses IS NULL OR times_used <= max_uses);

ALTER TABLE promo_codes DROP CONSTRAINT IF EXISTS promo_codes_times_used_non_negative;
ALTER TABLE promo_codes ADD CONSTRAINT promo_codes_times_used_non_negative
  CHECK (times_used >= 0);

-- --------------------------------------------------------------------- otp --

ALTER TABLE otp_codes DROP CONSTRAINT IF EXISTS otp_attempts_sane;
ALTER TABLE otp_codes ADD CONSTRAINT otp_attempts_sane
  CHECK (attempts >= 0 AND max_attempts > 0 AND attempts <= max_attempts);

-- ---------------------------------------------------------------- delivery --

ALTER TABLE delivery_options DROP CONSTRAINT IF EXISTS delivery_price_non_negative;
ALTER TABLE delivery_options ADD CONSTRAINT delivery_price_non_negative
  CHECK (price_cents >= 0 AND (free_over_cents IS NULL OR free_over_cents >= 0));

ALTER TABLE delivery_options DROP CONSTRAINT IF EXISTS delivery_days_ordered;
ALTER TABLE delivery_options ADD CONSTRAINT delivery_days_ordered
  CHECK (min_days IS NULL OR max_days IS NULL OR max_days >= min_days);

-- --------------------------------------------------------------- category --

-- A category cannot be its own parent. (Deeper cycles are prevented in the
-- admin service; this catches the trivial case cheaply.)
ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_not_own_parent;
ALTER TABLE categories ADD CONSTRAINT categories_not_own_parent
  CHECK (parent_id IS NULL OR parent_id <> id);

ALTER TABLE categories DROP CONSTRAINT IF EXISTS categories_parent_fk;
ALTER TABLE categories ADD CONSTRAINT categories_parent_fk
  FOREIGN KEY (parent_id) REFERENCES categories (id) ON DELETE RESTRICT;

-- ------------------------------------------------------------------ search --
-- Full-text search across all three locales at once, so a Greek search finds
-- Greek text and an English search finds English text without the caller
-- having to know which language a product was authored in.
--
-- 'simple' rather than a language-specific config on purpose: we index three
-- languages in one column, and 'simple' does not apply English stemming to
-- Greek or Russian words.

CREATE OR REPLACE FUNCTION product_search_text(
  p_name JSONB,
  p_summary JSONB,
  p_description JSONB
) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT concat_ws(' ',
    coalesce(p_name->>'en', ''),      coalesce(p_name->>'el', ''),      coalesce(p_name->>'ru', ''),
    coalesce(p_summary->>'en', ''),   coalesce(p_summary->>'el', ''),   coalesce(p_summary->>'ru', ''),
    coalesce(p_description->>'en',''),coalesce(p_description->>'el',''),coalesce(p_description->>'ru','')
  )
$$;

CREATE OR REPLACE FUNCTION products_refresh_search() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.search_text := product_search_text(NEW.name, NEW.summary, NEW.description);
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS products_search_trigger ON products;
CREATE TRIGGER products_search_trigger
  BEFORE INSERT OR UPDATE OF name, summary, description ON products
  FOR EACH ROW EXECUTE FUNCTION products_refresh_search();

CREATE INDEX IF NOT EXISTS products_search_tsv_idx
  ON products USING GIN (to_tsvector('simple', coalesce(search_text, '')));

-- Trigram index for "did you mean" / partial matching, so "hoodi" and
-- "blk hoodie" still return results (spec section 6).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS products_search_trgm_idx
  ON products USING GIN (coalesce(search_text, '') gin_trgm_ops);

CREATE INDEX IF NOT EXISTS variants_sku_trgm_idx
  ON product_variants USING GIN (sku gin_trgm_ops);

-- -------------------------------------------------------------- timestamps --

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'users','categories','carts','orders','payments','inventory','settings'
  ] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I_touch ON %I', t, t);
    EXECUTE format(
      'CREATE TRIGGER %I_touch BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t, t
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------- homepage layout --
-- A hand-picked homepage item is exactly one thing, and the right kind of
-- thing: categories in the category section, products everywhere else. A
-- product tile inside "Shop by category" would render as a broken link.

ALTER TABLE homepage_section_items DROP CONSTRAINT IF EXISTS homepage_items_one_target;
ALTER TABLE homepage_section_items ADD CONSTRAINT homepage_items_one_target
  CHECK ((product_id IS NULL) <> (category_id IS NULL));

ALTER TABLE homepage_section_items DROP CONSTRAINT IF EXISTS homepage_items_right_kind;
ALTER TABLE homepage_section_items ADD CONSTRAINT homepage_items_right_kind
  CHECK (
    (section_key = 'categories' AND category_id IS NOT NULL)
    OR (section_key <> 'categories' AND product_id IS NOT NULL)
  );

ALTER TABLE homepage_section_items DROP CONSTRAINT IF EXISTS homepage_items_position_non_negative;
ALTER TABLE homepage_section_items ADD CONSTRAINT homepage_items_position_non_negative
  CHECK (position >= 0);

ALTER TABLE homepage_sections DROP CONSTRAINT IF EXISTS homepage_sections_position_non_negative;
ALTER TABLE homepage_sections ADD CONSTRAINT homepage_sections_position_non_negative
  CHECK (position >= 0);

-- --------------------------------------------------------- customer service --
-- A closed conversation always says when; an open one never claims to be
-- closed. The inactivity sweep and the admin "Close" both rely on this.
ALTER TABLE support_conversations DROP CONSTRAINT IF EXISTS support_closed_consistent;
ALTER TABLE support_conversations ADD CONSTRAINT support_closed_consistent
  CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL));

-- A message has something in it, and not a novel: the widget allows 2,000.
ALTER TABLE support_messages DROP CONSTRAINT IF EXISTS support_message_length;
ALTER TABLE support_messages ADD CONSTRAINT support_message_length
  CHECK (char_length(body) BETWEEN 1 AND 2000);

-- A conversation belongs to someone: an account, or a guest's cookie.
ALTER TABLE support_conversations DROP CONSTRAINT IF EXISTS support_has_owner;
ALTER TABLE support_conversations ADD CONSTRAINT support_has_owner
  CHECK (user_id IS NOT NULL OR guest_token_hash IS NOT NULL);

-- --------------------------------------------------------------- newsletter --
-- Subscribed means confirmed. Nothing marketing is sent to anyone else, and
-- this makes "subscribed without ever confirming" impossible to store.
ALTER TABLE newsletter_subscribers DROP CONSTRAINT IF EXISTS newsletter_subscribed_confirmed;
ALTER TABLE newsletter_subscribers ADD CONSTRAINT newsletter_subscribed_confirmed
  CHECK (status <> 'SUBSCRIBED' OR (confirmed_at IS NOT NULL AND consent_at IS NOT NULL));

ALTER TABLE newsletter_subscribers DROP CONSTRAINT IF EXISTS newsletter_unsubscribed_dated;
ALTER TABLE newsletter_subscribers ADD CONSTRAINT newsletter_unsubscribed_dated
  CHECK (status <> 'UNSUBSCRIBED' OR unsubscribed_at IS NOT NULL);
