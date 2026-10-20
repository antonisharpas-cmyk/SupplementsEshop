/* ============================================================================
 * DATABASE SCHEMA
 *
 * Money is stored as INTEGER CENTS everywhere. Never floats — 0.1 + 0.2 must
 * never be able to become a customer's total.
 *
 * Translated text (product names, descriptions, category labels) is stored as
 * JSONB keyed by locale: { en: "...", el: "...", ru: "..." }. That keeps the
 * table count sane versus a translations table per entity, and Postgres can
 * index into it for search.
 *
 * The inventory model is the load-bearing part of this file — see `inventory`
 * and `inventoryReservations` below, and the CHECK constraints in
 * src/db/constraints.sql that make negative stock impossible at the database
 * level rather than by convention.
 * ========================================================================== */

import { relations, sql } from 'drizzle-orm'
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

/* ---------------------------------------------------------------- enums --- */

export const userRoleEnum = pgEnum('user_role', ['CUSTOMER', 'ADMIN', 'SUPER_ADMIN'])

export const orderStatusEnum = pgEnum('order_status', [
  'PENDING',
  'PAYMENT_PENDING',
  'PAID',
  'PROCESSING',
  'READY_FOR_PICKUP',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'REFUNDED',
])

export const paymentStatusEnum = pgEnum('payment_status', [
  'PENDING',
  'SUCCEEDED',
  'FAILED',
  'CANCELLED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
])

export const discountTypeEnum = pgEnum('discount_type', ['PERCENTAGE', 'FIXED'])

export const promotionScopeEnum = pgEnum('promotion_scope', [
  'PRODUCT',
  'CATEGORY',
  'SUBCATEGORY',
  'ALL',
])

export const deliveryKindEnum = pgEnum('delivery_kind', ['PICKUP', 'SHIPPING'])

/* Whether a VISIBLE product can be bought. Separate from `isActive` on
   purpose: hidden means "not in the shop", sold out means "in the shop, not
   purchasable right now". An enum rather than a flag, so later states (pre-
   order, coming soon) are a new value, not a new column. Stock still decides
   on its own: a product with nothing on the shelf is sold out whatever this
   says — this lets the owner declare it before the shelf is empty. */
export const productAvailabilityEnum = pgEnum('product_availability', ['AVAILABLE', 'SOLD_OUT'])

export const reservationStatusEnum = pgEnum('reservation_status', [
  'ACTIVE', // holding stock, will expire
  'CONSUMED', // converted into a paid order line
  'RELEASED', // returned to available stock
])

export const otpPurposeEnum = pgEnum('otp_purpose', [
  'REGISTRATION',
  'PASSWORD_RESET',
  'EMAIL_CHANGE',
])

export const enquiryTopicEnum = pgEnum('enquiry_topic', [
  'EXISTING_ORDER',
  'DELIVERY',
  'PAYMENT',
  'PRODUCT',
  'RETURN_REFUND',
  'GENERAL',
  'OTHER',
])

export const contactStatusEnum = pgEnum('contact_status', ['NEW', 'IN_PROGRESS', 'RESOLVED'])

/* ---------------------------------------------------------------- users --- */

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    /* E.164, normalised before insert. Uniqueness is enforced on the
       normalised value so +357 99 123456 and +35799123456 collide. */
    phone: varchar('phone', { length: 32 }).notNull(),
    passwordHash: text('password_hash').notNull(),
    firstName: varchar('first_name', { length: 80 }).notNull(),
    lastName: varchar('last_name', { length: 80 }).notNull(),
    role: userRoleEnum('role').notNull().default('CUSTOMER'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    /* Soft-disable rather than delete, so historical orders keep their customer. */
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    /* The language the customer registered in — every email to them uses it. */
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* Business rule 1 and 2: no duplicate email, no duplicate phone.
       Enforced by the database, not just by application checks — two
       simultaneous registrations cannot both win. */
    uniqueIndex('users_email_unique').on(sql`lower(${t.email})`),
    uniqueIndex('users_phone_unique').on(t.phone),
    index('users_role_idx').on(t.role),
    index('users_created_at_idx').on(t.createdAt),
  ],
)

export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    label: varchar('label', { length: 60 }),
    recipientName: varchar('recipient_name', { length: 160 }).notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    line1: varchar('line1', { length: 200 }).notNull(),
    line2: varchar('line2', { length: 200 }),
    city: varchar('city', { length: 100 }).notNull(),
    postalCode: varchar('postal_code', { length: 20 }).notNull(),
    country: varchar('country', { length: 2 }).notNull().default('CY'),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('addresses_user_idx').on(t.userId),
    /* At most one default per user — a partial unique index, so the
       "set default" operation is safe under concurrency. */
    uniqueIndex('addresses_one_default_per_user')
      .on(t.userId)
      .where(sql`${t.isDefault} = true`),
  ],
)

/* -------------------------------------------------------------- sessions -- */

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /* SHA-256 of the opaque token. The raw token only ever exists in the
       cookie, so a database leak does not hand over live sessions. */
    tokenHash: varchar('token_hash', { length: 64 }).notNull(),
    userAgent: varchar('user_agent', { length: 400 }),
    ipHash: varchar('ip_hash', { length: 64 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sessions_token_hash_unique').on(t.tokenHash),
    index('sessions_user_idx').on(t.userId),
    index('sessions_expires_idx').on(t.expiresAt),
  ],
)

/* ------------------------------------------------------------------ otp --- */

export const otpCodes = pgTable(
  'otp_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /* Pending registrations have no user row yet, so OTP keys on the email. */
    email: varchar('email', { length: 255 }).notNull(),
    purpose: otpPurposeEnum('purpose').notNull(),
    /* Hashed. An admin reading the table must not be able to use a code. */
    codeHash: varchar('code_hash', { length: 64 }).notNull(),
    /* The registration payload, held until the code is verified so that an
       unverified signup never creates a user row. */
    pendingPayload: jsonb('pending_payload'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('otp_email_purpose_idx').on(sql`lower(${t.email})`, t.purpose),
    index('otp_expires_idx').on(t.expiresAt),
  ],
)

/* ----------------------------------------------------------- categories --- */

/* One self-referencing table rather than separate Categories/Subcategories.
   The spec lists them separately, but a parent_id gives the same two levels
   plus room for a third later without a migration, and "reorder" and
   "enable/disable" then work identically at both levels. */
export const categories = pgTable(
  'categories',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    parentId: uuid('parent_id'),
    slug: varchar('slug', { length: 120 }).notNull(),
    /* { en, el, ru } */
    name: jsonb('name').$type<Record<string, string>>().notNull(),
    description: jsonb('description').$type<Record<string, string>>(),
    seoTitle: jsonb('seo_title').$type<Record<string, string>>(),
    seoDescription: jsonb('seo_description').$type<Record<string, string>>(),
    imageUrl: text('image_url'),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* Slug unique within a parent, so /men/hoodies and /women/hoodies can
       coexist. A NULL parent needs its own index because NULLs don't compare. */
    uniqueIndex('categories_slug_per_parent').on(t.parentId, t.slug),
    uniqueIndex('categories_root_slug')
      .on(t.slug)
      .where(sql`${t.parentId} is null`),
    index('categories_parent_position_idx').on(t.parentId, t.position),
  ],
)

/* ------------------------------------------------------------- products --- */

export const products = pgTable(
  'products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    slug: varchar('slug', { length: 160 }).notNull(),
    name: jsonb('name').$type<Record<string, string>>().notNull(),
    description: jsonb('description').$type<Record<string, string>>(),
    /* Short line for cards and meta descriptions. */
    summary: jsonb('summary').$type<Record<string, string>>(),
    seoTitle: jsonb('seo_title').$type<Record<string, string>>(),
    seoDescription: jsonb('seo_description').$type<Record<string, string>>(),
    /* Base price in cents, VAT-inclusive. Variants may override. */
    priceCents: integer('price_cents').notNull(),
    /* Manual sale price. Promotions (below) are separate and stack per the
       resolution rules in src/lib/pricing.ts — never both silently. */
    salePriceCents: integer('sale_price_cents'),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    sizeGuide: jsonb('size_guide').$type<Record<string, string>>(),
    /* Free-text search vector maintained by a trigger — see constraints.sql */
    searchText: text('search_text'),
    isActive: boolean('is_active').notNull().default(false),
    availability: productAvailabilityEnum('availability').notNull().default('AVAILABLE'),
    publishedAt: timestamp('published_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('products_slug_unique').on(t.slug),
    index('products_category_idx').on(t.categoryId),
    index('products_active_idx').on(t.isActive),
    index('products_price_idx').on(t.priceCents),
    index('products_created_idx').on(t.createdAt),
  ],
)

export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    /* Nullable: an image can belong to a specific colourway or to the product. */
    variantId: uuid('variant_id'),
    url: text('url').notNull(),
    alt: jsonb('alt').$type<Record<string, string>>(),
    width: integer('width'),
    height: integer('height'),
    position: integer('position').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('product_images_product_position_idx').on(t.productId, t.position)],
)

/* A variant is one sellable thing: this product, in this colour, in this size.
   Stock lives against the variant, never the product — "M is out of stock but
   L is not" is the normal case in fashion. */
export const productVariants = pgTable(
  'product_variants',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    sku: varchar('sku', { length: 64 }).notNull(),
    size: varchar('size', { length: 24 }).notNull(),
    colorName: jsonb('color_name').$type<Record<string, string>>(),
    colorHex: varchar('color_hex', { length: 7 }),
    /* Overrides the product price when set — e.g. a 3XL that costs more. */
    priceCentsOverride: integer('price_cents_override'),
    salePriceCentsOverride: integer('sale_price_cents_override'),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('variants_sku_unique').on(t.sku),
    uniqueIndex('variants_product_size_color').on(t.productId, t.size, t.colorHex),
    index('variants_product_idx').on(t.productId),
  ],
)

/* ---------------------------------------------------------------- media --- */

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
})

/* Photos uploaded in the admin panel. Kept in the database rather than on the
   server's disk, so they survive a redeploy on hosts with no persistent disk
   (Render, Railway) and are backed up with everything else. Served by
   /api/media/[id] with long cache headers. */
export const media = pgTable(
  'media',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    contentType: varchar('content_type', { length: 60 }).notNull(),
    bytes: bytea('bytes').notNull(),
    size: integer('size').notNull(),
    filename: varchar('filename', { length: 200 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
)

/* ------------------------------------------------------------ inventory --- */

/* One row per variant. `onHand` is the physical count; `reserved` is how much
 * of it is currently held by carts. Available = onHand - reserved, exposed as
 * a generated column so no caller can compute it differently.
 *
 * Every mutation goes through src/lib/inventory.ts, which takes a row lock.
 * CHECK constraints in constraints.sql guarantee that even a bug cannot drive
 * either number negative or push reserved past onHand.
 */
export const inventory = pgTable(
  'inventory',
  {
    variantId: uuid('variant_id')
      .primaryKey()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    onHand: integer('on_hand').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    /* Admin-facing threshold for the low-stock highlight. */
    lowStockThreshold: integer('low_stock_threshold').notNull().default(3),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('inventory_low_stock_idx').on(t.onHand, t.reserved)],
)

export const inventoryReservations = pgTable(
  'inventory_reservations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    status: reservationStatusEnum('status').notNull().default('ACTIVE'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    releasedAt: timestamp('released_at', { withTimezone: true }),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    orderId: uuid('order_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* The sweep query: find ACTIVE reservations past expiry. */
    index('reservations_active_expiry_idx')
      .on(t.expiresAt)
      .where(sql`${t.status} = 'ACTIVE'`),
    index('reservations_cart_idx').on(t.cartId),
    index('reservations_variant_idx').on(t.variantId),
    /* One active reservation per cart per variant, so quantity changes update
       in place instead of stacking duplicate holds. */
    uniqueIndex('reservations_one_active_per_cart_variant')
      .on(t.cartId, t.variantId)
      .where(sql`${t.status} = 'ACTIVE'`),
  ],
)

/* ----------------------------------------------------------------- cart --- */

export const carts = pgTable(
  'carts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /* Either a logged-in user or an anonymous cookie token — never both null,
       which `carts_has_an_owner` enforces.

       CASCADE, not SET NULL: a signed-in cart has no anonymous token, so
       nulling the user leaves a row that owns stock and that nobody can reach
       — and the CHECK constraint rightly refuses it, which used to make
       deleting a customer fail outright. A cart is working state, not history;
       the orders are the history and they are kept. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    anonymousToken: varchar('anonymous_token', { length: 64 }),
    appliedPromoCodeId: uuid('applied_promo_code_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('carts_anonymous_token_unique').on(t.anonymousToken),
    index('carts_user_idx').on(t.userId),
    index('carts_updated_idx').on(t.updatedAt),
  ],
)

export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('cart_items_cart_variant_unique').on(t.cartId, t.variantId),
    index('cart_items_cart_idx').on(t.cartId),
  ],
)

/* --------------------------------------------------------------- orders --- */

/* Business rule 18: an order is an immutable record of what was agreed.
   Every price, name and discount is COPIED in at checkout time, so editing a
   product or expiring a promo code later cannot rewrite history. */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /* Human-facing, used with email for guest order tracking. */
    orderNumber: varchar('order_number', { length: 20 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    /* Contact details are snapshotted — a guest has no user row, and a
       registered customer may later change their email. */
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    customerName: varchar('customer_name', { length: 160 }).notNull(),

    status: orderStatusEnum('status').notNull().default('PENDING'),

    deliveryKind: deliveryKindEnum('delivery_kind').notNull(),
    deliveryOptionId: uuid('delivery_option_id'),
    deliveryOptionName: jsonb('delivery_option_name').$type<Record<string, string>>(),
    /* Full address copied in, not referenced — the customer may delete theirs. */
    shippingAddress: jsonb('shipping_address').$type<Record<string, unknown>>(),
    billingAddress: jsonb('billing_address').$type<Record<string, unknown>>(),

    subtotalCents: integer('subtotal_cents').notNull(),
    promotionDiscountCents: integer('promotion_discount_cents').notNull().default(0),
    promoCodeDiscountCents: integer('promo_code_discount_cents').notNull().default(0),
    deliveryCents: integer('delivery_cents').notNull().default(0),
    totalCents: integer('total_cents').notNull(),
    vatCents: integer('vat_cents').notNull().default(0),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),

    /* Snapshot, so the order still explains itself if the code is deleted. */
    promoCodeId: uuid('promo_code_id'),
    promoCodeSnapshot: jsonb('promo_code_snapshot').$type<Record<string, unknown>>(),

    customerNote: text('customer_note'),
    adminNote: text('admin_note'),
    /* 'card' (Stripe) or 'cod' (cash on delivery). */
    paymentMethod: varchar('payment_method', { length: 20 }).notNull().default('card'),
    /* 'web' (the shop) or 'phone' (entered by staff in the admin). */
    channel: varchar('channel', { length: 12 }).notNull().default('web'),
    /* Who entered a phone order. */
    createdBy: uuid('created_by'),
    trackingNumber: varchar('tracking_number', { length: 80 }),
    trackingUrl: text('tracking_url'),
    /* A random secret so a guest can open their own order page from the
       confirmation link and email without an account. Never shown to staff. */
    accessToken: varchar('access_token', { length: 64 }),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),

    estimatedDeliveryFrom: timestamp('estimated_delivery_from', { withTimezone: true }),
    estimatedDeliveryTo: timestamp('estimated_delivery_to', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    shippedAt: timestamp('shipped_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('orders_number_unique').on(t.orderNumber),
    index('orders_user_idx').on(t.userId),
    index('orders_status_idx').on(t.status),
    index('orders_created_idx').on(t.createdAt),
    /* Guest tracking looks up by number + email together. */
    index('orders_number_email_idx').on(t.orderNumber, sql`lower(${t.email})`),
  ],
)

/* Invoices and credit notes, for the accountant.
   Issued once an order is paid, numbered without gaps per kind, and never
   edited afterwards: everything printed on it is copied in, so changing a
   product name, a price or the shop's address later cannot rewrite history.
   A refund issues a credit note against the invoice instead. */
export const invoices = pgTable(
  'invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /* INV-2026-000001, CN-2026-000001 */
    number: varchar('number', { length: 32 }).notNull(),
    /* 'INVOICE' or 'CREDIT_NOTE' */
    kind: varchar('kind', { length: 12 }).notNull(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    orderNumber: varchar('order_number', { length: 20 }).notNull(),
    /* A credit note points at the invoice it corrects. */
    relatesToId: uuid('relates_to_id'),
    issuedAt: timestamp('issued_at', { withTimezone: true }).notNull().defaultNow(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /* Always positive; the kind says which way the money went. */
    netCents: integer('net_cents').notNull(),
    vatCents: integer('vat_cents').notNull(),
    totalCents: integer('total_cents').notNull(),
    vatRateBp: integer('vat_rate_bp').notNull(),
    paymentMethod: varchar('payment_method', { length: 20 }).notNull(),
    customer: jsonb('customer').$type<InvoiceParty>().notNull(),
    seller: jsonb('seller').$type<InvoiceParty>().notNull(),
    lines: jsonb('lines').$type<InvoiceLine[]>().notNull(),
    note: text('note'),
  },
  (t) => [
    uniqueIndex('invoices_number_unique').on(t.number),
    /* One invoice per order; credit notes may be several. */
    uniqueIndex('invoices_one_per_order').on(t.orderId).where(sql`${t.kind} = 'INVOICE'`),
    index('invoices_issued_idx').on(t.issuedAt),
    index('invoices_order_idx').on(t.orderId),
  ],
)

export type InvoiceParty = {
  name: string
  email?: string
  phone?: string
  vatNumber?: string
  taxId?: string
  address?: string[]
}

export type InvoiceLine = {
  description: string
  sku?: string
  quantity: number
  unitCents: number
  totalCents: number
}

export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /* Kept for reporting, but nullable and SET NULL: deleting a product must
       never delete the record that it was sold. */
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),

    /* --- the snapshot --- */
    productName: varchar('product_name', { length: 300 }).notNull(),
    sku: varchar('sku', { length: 64 }).notNull(),
    size: varchar('size', { length: 24 }),
    colorName: varchar('color_name', { length: 80 }),
    imageUrl: text('image_url'),

    quantity: integer('quantity').notNull(),
    unitPriceCents: integer('unit_price_cents').notNull(),
    /* Per-line promotion discount at the moment of sale. */
    unitDiscountCents: integer('unit_discount_cents').notNull().default(0),
    lineTotalCents: integer('line_total_cents').notNull(),
    appliedPromotionId: uuid('applied_promotion_id'),
    appliedPromotionSnapshot: jsonb('applied_promotion_snapshot').$type<Record<string, unknown>>(),
  },
  (t) => [index('order_items_order_idx').on(t.orderId)],
)

/* ------------------------------------------------------------- payments --- */

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 30 }).notNull().default('stripe'),
    /* Stripe PaymentIntent id. Unique, so a replayed webhook is a no-op. */
    providerPaymentId: varchar('provider_payment_id', { length: 120 }),
    providerSessionId: varchar('provider_session_id', { length: 120 }),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    amountCents: integer('amount_cents').notNull(),
    currency: varchar('currency', { length: 3 }).notNull().default('EUR'),
    /* Display only — brand and last four. Never a full number, never a CVV. */
    cardBrand: varchar('card_brand', { length: 30 }),
    cardLast4: varchar('card_last4', { length: 4 }),
    failureCode: varchar('failure_code', { length: 80 }),
    failureMessage: text('failure_message'),
    refundedCents: integer('refunded_cents').notNull().default(0),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('payments_provider_payment_unique').on(t.providerPaymentId),
    index('payments_order_idx').on(t.orderId),
    index('payments_status_idx').on(t.status),
  ],
)

/* Every Stripe event we have already handled, so a redelivery cannot double
   count. Stripe explicitly does not guarantee at-most-once delivery. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: varchar('id', { length: 120 }).primaryKey(),
    provider: varchar('provider', { length: 30 }).notNull().default('stripe'),
    type: varchar('type', { length: 120 }).notNull(),
    payload: jsonb('payload'),
    processedAt: timestamp('processed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('webhook_events_type_idx').on(t.type)],
)

/* ----------------------------------------------------------- promotions --- */

export const promotions = pgTable(
  'promotions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: varchar('name', { length: 160 }).notNull(),
    scope: promotionScopeEnum('scope').notNull(),
    /* Exactly one of these is set, matching `scope`. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    discountType: discountTypeEnum('discount_type').notNull(),
    discountValue: integer('discount_value').notNull(), // percent, or cents
    /* Shown on cards and the homepage banner. */
    badgeText: jsonb('badge_text').$type<Record<string, string>>(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    priority: integer('priority').notNull().default(0),
    showOnHomepage: boolean('show_on_homepage').notNull().default(false),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('promotions_window_idx').on(t.startsAt, t.endsAt),
    index('promotions_active_idx').on(t.isActive),
    index('promotions_product_idx').on(t.productId),
    index('promotions_category_idx').on(t.categoryId),
  ],
)

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    code: varchar('code', { length: 40 }).notNull(),
    discountType: discountTypeEnum('discount_type').notNull(),
    discountValue: integer('discount_value').notNull(),
    minOrderCents: integer('min_order_cents').notNull().default(0),
    maxUses: integer('max_uses'),
    maxUsesPerUser: integer('max_uses_per_user').default(1),
    /* Denormalised counter, incremented inside the order transaction so the
       usage limit cannot be exceeded by simultaneous checkouts. */
    timesUsed: integer('times_used').notNull().default(0),
    /* Optional restriction to specific products or categories. */
    productIds: jsonb('product_ids').$type<string[]>(),
    categoryIds: jsonb('category_ids').$type<string[]>(),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('promo_codes_code_unique').on(sql`upper(${t.code})`),
    index('promo_codes_active_idx').on(t.isActive, t.expiresAt),
  ],
)

export const promoCodeUsage = pgTable(
  'promo_code_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    promoCodeId: uuid('promo_code_id')
      .notNull()
      .references(() => promoCodes.id, { onDelete: 'cascade' }),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: varchar('email', { length: 255 }).notNull(),
    discountCents: integer('discount_cents').notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('promo_usage_order_unique').on(t.orderId),
    index('promo_usage_code_idx').on(t.promoCodeId),
    index('promo_usage_email_idx').on(t.promoCodeId, sql`lower(${t.email})`),
  ],
)

/* ------------------------------------------------------------- wishlist --- */

export const wishlists = pgTable(
  'wishlists',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('wishlists_user_unique').on(t.userId)],
)

export const wishlistItems = pgTable(
  'wishlist_items',
  {
    wishlistId: uuid('wishlist_id')
      .notNull()
      .references(() => wishlists.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'cascade' }),
    addedAt: timestamp('added_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.wishlistId, t.productId] }),
    index('wishlist_items_product_idx').on(t.productId),
  ],
)

/* ------------------------------------------------- contact & marketing --- */

export const contactRequests = pgTable(
  'contact_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    topic: enquiryTopicEnum('topic').notNull(),
    orderNumber: varchar('order_number', { length: 20 }),
    subject: varchar('subject', { length: 200 }).notNull(),
    message: text('message').notNull(),
    email: varchar('email', { length: 255 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    status: contactStatusEnum('status').notNull().default('NEW'),
    adminNote: text('admin_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('contact_status_idx').on(t.status),
    index('contact_created_idx').on(t.createdAt),
  ],
)

/* Append-only consent log. GDPR wants proof of when and how consent was
   given, which a single boolean on the user row cannot provide. */
export const marketingConsents = pgTable(
  'marketing_consents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    granted: boolean('granted').notNull(),
    /* 'registration' | 'checkout' | 'footer' | 'account' */
    source: varchar('source', { length: 40 }).notNull(),
    ipHash: varchar('ip_hash', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('marketing_email_idx').on(sql`lower(${t.email})`, t.createdAt)],
)

/* ------------------------------------------------ storefront settings --- */

export const heroBanners = pgTable(
  'hero_banners',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    title: jsonb('title').$type<Record<string, string>>().notNull(),
    subtitle: jsonb('subtitle').$type<Record<string, string>>(),
    imageUrl: text('image_url'),
    mobileImageUrl: text('mobile_image_url'),
    /* A muted loop that plays over the image; the image stays as its poster
       (first paint, reduced motion, Save-Data). Portrait cut for phones. */
    videoUrl: text('video_url'),
    mobileVideoUrl: text('mobile_video_url'),
    /* Up to two CTAs — "SHOP MEN" / "SHOP WOMEN". */
    primaryCtaLabel: jsonb('primary_cta_label').$type<Record<string, string>>(),
    primaryCtaHref: varchar('primary_cta_href', { length: 300 }),
    secondaryCtaLabel: jsonb('secondary_cta_label').$type<Record<string, string>>(),
    secondaryCtaHref: varchar('secondary_cta_href', { length: 300 }),
    textAlign: varchar('text_align', { length: 10 }).notNull().default('left'),
    position: integer('position').notNull().default(0),
    startsAt: timestamp('starts_at', { withTimezone: true }),
    endsAt: timestamp('ends_at', { withTimezone: true }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('hero_active_window_idx').on(t.isActive, t.startsAt, t.endsAt)],
)

/* ------------------------------------------------------ homepage layout -- */
/* The four product/category sections below the hero, arranged by the shop
   owner in the admin panel: their order, whether each is shown, and — per
   section — whether the shop fills it automatically (newest, most viewed,
   reduced) or shows exactly the items the owner picked, in their order.

   A missing row means "the default": this table only needs a row once the
   owner has changed something, so a fresh database needs no setup step. */

export const homepageSectionKeyEnum = pgEnum('homepage_section_key', [
  'categories',
  'trending',
  'new_in',
  'on_sale',
  'newsletter',
])

export const homepageSectionModeEnum = pgEnum('homepage_section_mode', ['auto', 'manual'])

export const homepageSections = pgTable('homepage_sections', {
  key: homepageSectionKeyEnum('key').primaryKey(),
  position: integer('position').notNull(),
  isVisible: boolean('is_visible').notNull().default(true),
  mode: homepageSectionModeEnum('mode').notNull().default('auto'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/* The hand-picked contents of a section in manual mode. A product section
   holds products, the category section holds categories — never both, and
   never the wrong kind (see constraints.sql). Deleting a product or category
   removes it from every section rather than leaving a hole. */
export const homepageSectionItems = pgTable(
  'homepage_section_items',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    sectionKey: homepageSectionKeyEnum('section_key').notNull(),
    productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').references(() => categories.id, { onDelete: 'cascade' }),
    position: integer('position').notNull(),
  },
  (t) => [
    index('homepage_items_section_position_idx').on(t.sectionKey, t.position),
    uniqueIndex('homepage_items_section_product_uq').on(t.sectionKey, t.productId),
    uniqueIndex('homepage_items_section_category_uq').on(t.sectionKey, t.categoryId),
  ],
)

export const deliveryOptions = pgTable(
  'delivery_options',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kind: deliveryKindEnum('kind').notNull(),
    name: jsonb('name').$type<Record<string, string>>().notNull(),
    description: jsonb('description').$type<Record<string, string>>(),
    priceCents: integer('price_cents').notNull().default(0),
    /* Per-option override; falls back to the global setting when null. */
    freeOverCents: integer('free_over_cents'),
    minDays: integer('min_days'),
    maxDays: integer('max_days'),
    countries: jsonb('countries').$type<string[]>(),
    position: integer('position').notNull().default(0),
    isActive: boolean('is_active').notNull().default(true),
  },
  (t) => [index('delivery_options_active_idx').on(t.isActive, t.position)],
)

/* Typed key/value store for the things section 14 and 31 require to be
   admin-editable rather than hardcoded: free-delivery threshold, VAT rate,
   reservation TTL, low-stock threshold. */
export const settings = pgTable('settings', {
  key: varchar('key', { length: 80 }).primaryKey(),
  value: jsonb('value').notNull(),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
})

/* Who changed what in the admin panel. */
export const auditLog = pgTable(
  'audit_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    actorEmail: varchar('actor_email', { length: 255 }),
    action: varchar('action', { length: 80 }).notNull(),
    entity: varchar('entity', { length: 60 }).notNull(),
    entityId: varchar('entity_id', { length: 64 }),
    diff: jsonb('diff'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('audit_entity_idx').on(t.entity, t.entityId), index('audit_created_idx').on(t.createdAt)],
)

/* Powers "Recently viewed products" on the product page. */
export const productViews = pgTable(
  'product_views',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    anonymousToken: varchar('anonymous_token', { length: 64 }),
    viewedAt: timestamp('viewed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('product_views_user_idx').on(t.userId, t.viewedAt),
    index('product_views_anon_idx').on(t.anonymousToken, t.viewedAt),
  ],
)

/* ------------------------------------------------------------ relations --- */

export const usersRelations = relations(users, ({ many, one }) => ({
  addresses: many(addresses),
  orders: many(orders),
  sessions: many(sessions),
  wishlist: one(wishlists),
}))

export const addressesRelations = relations(addresses, ({ one }) => ({
  user: one(users, { fields: [addresses.userId], references: [users.id] }),
}))

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
    relationName: 'category_tree',
  }),
  children: many(categories, { relationName: 'category_tree' }),
  products: many(products),
}))

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, { fields: [products.categoryId], references: [categories.id] }),
  images: many(productImages),
  variants: many(productVariants),
}))

export const productVariantsRelations = relations(productVariants, ({ one, many }) => ({
  product: one(products, { fields: [productVariants.productId], references: [products.id] }),
  inventory: one(inventory, {
    fields: [productVariants.id],
    references: [inventory.variantId],
  }),
  reservations: many(inventoryReservations),
}))

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, { fields: [productImages.productId], references: [products.id] }),
}))

export const inventoryRelations = relations(inventory, ({ one }) => ({
  variant: one(productVariants, {
    fields: [inventory.variantId],
    references: [productVariants.id],
  }),
}))

export const cartsRelations = relations(carts, ({ one, many }) => ({
  user: one(users, { fields: [carts.userId], references: [users.id] }),
  items: many(cartItems),
  reservations: many(inventoryReservations),
}))

export const cartItemsRelations = relations(cartItems, ({ one }) => ({
  cart: one(carts, { fields: [cartItems.cartId], references: [carts.id] }),
  variant: one(productVariants, {
    fields: [cartItems.variantId],
    references: [productVariants.id],
  }),
}))

export const inventoryReservationsRelations = relations(inventoryReservations, ({ one }) => ({
  variant: one(productVariants, {
    fields: [inventoryReservations.variantId],
    references: [productVariants.id],
  }),
  cart: one(carts, { fields: [inventoryReservations.cartId], references: [carts.id] }),
}))

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, { fields: [orders.userId], references: [users.id] }),
  items: many(orderItems),
  payments: many(payments),
}))

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
}))

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, { fields: [payments.orderId], references: [orders.id] }),
}))

export const promoCodesRelations = relations(promoCodes, ({ many }) => ({
  usages: many(promoCodeUsage),
}))

export const wishlistsRelations = relations(wishlists, ({ one, many }) => ({
  user: one(users, { fields: [wishlists.userId], references: [users.id] }),
  items: many(wishlistItems),
}))

export const wishlistItemsRelations = relations(wishlistItems, ({ one }) => ({
  wishlist: one(wishlists, { fields: [wishlistItems.wishlistId], references: [wishlists.id] }),
  product: one(products, { fields: [wishlistItems.productId], references: [products.id] }),
}))

/* ---------------------------------------------------------------- types --- */

export type User = typeof users.$inferSelect
export type NewUser = typeof users.$inferInsert
export type Address = typeof addresses.$inferSelect
export type Category = typeof categories.$inferSelect
export type Product = typeof products.$inferSelect
export type ProductVariant = typeof productVariants.$inferSelect
export type ProductImage = typeof productImages.$inferSelect
export type Inventory = typeof inventory.$inferSelect
export type InventoryReservation = typeof inventoryReservations.$inferSelect
export type Cart = typeof carts.$inferSelect
export type CartItem = typeof cartItems.$inferSelect
export type Order = typeof orders.$inferSelect
export type OrderItem = typeof orderItems.$inferSelect
export type Payment = typeof payments.$inferSelect
export type Promotion = typeof promotions.$inferSelect
export type PromoCode = typeof promoCodes.$inferSelect
export type HeroBanner = typeof heroBanners.$inferSelect
export type DeliveryOption = typeof deliveryOptions.$inferSelect
export type ContactRequest = typeof contactRequests.$inferSelect
export type Setting = typeof settings.$inferSelect

export type OrderStatus = (typeof orderStatusEnum.enumValues)[number]
export type PaymentStatus = (typeof paymentStatusEnum.enumValues)[number]
export type UserRole = (typeof userRoleEnum.enumValues)[number]

/* ------------------------------------------------------------- newsletter -- */
/* Who asked to hear about new arrivals. The CURRENT state lives here; the
   history of every yes and no lives in `marketing_consents`, which is the
   record that proves consent.

   Double opt-in: a signup is PENDING until the person clicks the link emailed
   to them. Nobody can subscribe someone else's address, and nothing marketing
   is ever sent to a PENDING or UNSUBSCRIBED row. */

export const subscriberStatusEnum = pgEnum('subscriber_status', [
  'PENDING',
  'SUBSCRIBED',
  'UNSUBSCRIBED',
])

export const newsletterSubscribers = pgTable(
  'newsletter_subscribers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 255 }).notNull(),
    firstName: varchar('first_name', { length: 80 }),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    status: subscriberStatusEnum('status').notNull().default('PENDING'),
    /* 'homepage' | 'footer' | 'registration' | 'announcement' — where they said yes. */
    source: varchar('source', { length: 40 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    /* Throttles re-sending the confirmation email to one address. */
    lastConfirmationSentAt: timestamp('last_confirmation_sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('newsletter_email_unique').on(sql`lower(${t.email})`),
    index('newsletter_status_idx').on(t.status),
  ],
)

/* One row per mailing, so a double-click cannot send it twice and the owner
   can see what went out, to how many, and when. */
export const newsletterCampaigns = pgTable('newsletter_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  /* 'new_arrivals' | 'promotion' */
  kind: varchar('kind', { length: 40 }).notNull(),
  subject: varchar('subject', { length: 200 }).notNull(),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  recipientCount: integer('recipient_count').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  /* Recipients left out because another marketing email reached them too
     recently (frequency protection). */
  skippedCount: integer('skipped_count').notNull().default(0),
  /* 'SCHEDULED' | 'SENDING' | 'SENT' | 'CANCELLED' */
  status: varchar('status', { length: 16 }).notNull().default('SENDING'),
  /* What the owner wrote and chose: message, products or a category, the
     call to action, a promotion code, the language. See CampaignDraft. */
  content: jsonb('content').$type<Record<string, unknown>>(),
  /* When to send; null = straight away. */
  scheduledAt: timestamp('scheduled_at', { withTimezone: true }),
  startedAt: timestamp('started_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

/* -------------------------------------------------------- SMS marketing -- */
/* Who said yes to offers by SMS. Consent is per phone number, recorded with
   where and when it was given; saying no keeps the row (as UNSUBSCRIBED) so
   the number is never added back by accident. */
export const smsSubscribers = pgTable(
  'sms_subscribers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /* E.164, e.g. +35799123456 */
    phone: varchar('phone', { length: 20 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    firstName: varchar('first_name', { length: 80 }),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    /* 'SUBSCRIBED' | 'UNSUBSCRIBED' */
    status: varchar('status', { length: 16 }).notNull().default('SUBSCRIBED'),
    /* 'registration' | 'checkout' | 'account' | 'admin' */
    source: varchar('source', { length: 40 }).notNull(),
    consentAt: timestamp('consent_at', { withTimezone: true }),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('sms_subscribers_phone_unique').on(t.phone),
    index('sms_subscribers_status_idx').on(t.status),
    index('sms_subscribers_user_idx').on(t.userId),
  ],
)

/* One row per SMS campaign: what was sent, to whom, and how it went. */
export const smsCampaigns = pgTable('sms_campaigns', {
  id: uuid('id').defaultRandom().primaryKey(),
  /* Exactly as sent, opt out line included. */
  message: text('message').notNull(),
  /* 'all' | 'en' | 'el' | 'ru' */
  audience: varchar('audience', { length: 8 }).notNull().default('all'),
  senderId: varchar('sender_id', { length: 20 }).notNull(),
  segments: integer('segments').notNull().default(1),
  recipientCount: integer('recipient_count').notNull().default(0),
  sentCount: integer('sent_count').notNull().default(0),
  failedCount: integer('failed_count').notNull().default(0),
  /* 'SENDING' | 'SENT' | 'PARTIAL' | 'FAILED' | 'LOGGED' (no provider set) */
  status: varchar('status', { length: 16 }).notNull().default('SENDING'),
  /* sms.to ids for each batch, to look the campaign up in their dashboard. */
  providerRefs: jsonb('provider_refs').$type<string[]>(),
  error: text('error'),
  createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
})

/* ------------------------------------------------------- customer service -- */
/* A conversation between one customer and "the shop". The customer always
   sees the shop's name, never which staff member replied — that is kept, for
   the owner, in `staffUserId`, and never sent to the customer.

   Ownership: a signed-in customer owns it by `userId`; a guest by a random
   token in an httpOnly cookie, of which only the hash is stored here. */

export const supportStatusEnum = pgEnum('support_status', ['OPEN', 'CLOSED'])
export const supportSenderEnum = pgEnum('support_sender', ['CUSTOMER', 'STAFF'])
export const supportCloseReasonEnum = pgEnum('support_close_reason', [
  'STAFF',
  'INACTIVITY',
])

export const supportConversations = pgTable(
  'support_conversations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    guestTokenHash: varchar('guest_token_hash', { length: 64 }),
    name: varchar('name', { length: 120 }),
    email: varchar('email', { length: 255 }),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    /* The page they were on when they asked — "do you have this in black?"
       means nothing without it. */
    pageUrl: varchar('page_url', { length: 500 }),
    status: supportStatusEnum('status').notNull().default('OPEN'),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    /* Moves on every message from either side — and only on messages. The
       inactivity close is measured from here. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    closedReason: supportCloseReasonEnum('closed_reason'),
    closedBy: uuid('closed_by').references(() => users.id, { onDelete: 'set null' }),
    /* Read markers: a message is "read" by the other side once it is older
       than their marker — one timestamp per side instead of one per message. */
    staffLastReadAt: timestamp('staff_last_read_at', { withTimezone: true }),
    customerLastReadAt: timestamp('customer_last_read_at', { withTimezone: true }),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
    transcriptSentAt: timestamp('transcript_sent_at', { withTimezone: true }),
    /* The AI assistant answers until a person takes over: staff reply, or
       the customer asks for a person, or the assistant hands over itself. */
    aiActive: boolean('ai_active').notNull().default(true),
    /* Set while the assistant is writing ("typing…"); cleared when done. */
    aiTypingAt: timestamp('ai_typing_at', { withTimezone: true }),
    /* When it was passed to a person, so the inbox can show "needs a person". */
    handoffAt: timestamp('handoff_at', { withTimezone: true }),
    aiReplies: integer('ai_replies').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('support_status_activity_idx').on(t.status, t.lastActivityAt),
    index('support_user_idx').on(t.userId),
    index('support_guest_idx').on(t.guestTokenHash),
  ],
)

export type SupportMessageMeta = {
  products?: { slug: string; name: string; price: string; image: string | null; inStock: boolean }[]
  suggestions?: string[]
}

export const supportMessages = pgTable(
  'support_messages',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    conversationId: uuid('conversation_id')
      .notNull()
      .references(() => supportConversations.id, { onDelete: 'cascade' }),
    sender: supportSenderEnum('sender').notNull(),
    /* Internal only — which staff member wrote it. Never sent to customers. */
    staffUserId: uuid('staff_user_id').references(() => users.id, { onDelete: 'set null' }),
    /* The automatic first reply ("Thank you for contacting…"), not a person. */
    automated: boolean('automated').notNull().default(false),
    /* Written by the AI assistant (always shown to the customer as such). */
    ai: boolean('ai').notNull().default(false),
    /* Extras the assistant attached: product cards and suggested replies. */
    meta: jsonb('meta').$type<SupportMessageMeta>(),
    body: text('body').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('support_messages_conversation_idx').on(t.conversationId, t.createdAt)],
)

/* ----------------------------------------------------------------- email -- */
/* Every email the shop tries to send: what, to whom, and whether it went.
   Feeds "failed emails" on the admin overview. The body is kept only when no
   provider is configured (development), so it can be read and tested; with a
   real provider, only the envelope is stored. */
export const emailLog = pgTable(
  'email_log',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /* 'support_new' | 'support_transcript' | 'newsletter_confirm' | … */
    kind: varchar('kind', { length: 40 }).notNull(),
    /* 'transactional' | 'lifecycle' | 'marketing' — never mixed: marketing needs consent. */
    category: varchar('category', { length: 16 }).notNull(),
    toEmail: varchar('to_email', { length: 255 }).notNull(),
    subject: varchar('subject', { length: 300 }).notNull(),
    /* 'sent' | 'failed' | 'logged' (no provider — written here instead) */
    status: varchar('status', { length: 16 }).notNull(),
    error: text('error'),
    body: text('body'),
    relatedId: varchar('related_id', { length: 64 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('email_log_created_idx').on(t.createdAt),
    index('email_log_related_idx').on(t.relatedId),
    index('email_log_to_idx').on(sql`lower(${t.toEmail})`, t.createdAt),
  ],
)

/* ------------------------------------------------------ email templates -- */
/* The owner's edits to the built-in email templates (src/lib/email-templates.ts).
   One row per template that has been changed; anything not stored here — a
   language never edited, a template never touched — uses the built-in text.
   So new templates need no data migration, and "reset" is deleting the row. */
export const emailTemplates = pgTable('email_templates', {
  key: varchar('key', { length: 60 }).primaryKey(),
  /* Null = the template's own default. Required templates ignore false. */
  enabled: boolean('enabled'),
  /* Minutes after the trigger, for templates with timing. */
  delayMinutes: integer('delay_minutes'),
  /* { en: { subject, body, cta }, el: …, ru: … } — any part may be missing. */
  content: jsonb('content').$type<Record<string, { subject?: string; body?: string; cta?: string }>>(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/* ---------------------------------------------------------- email jobs -- */
/* Every automated email the shop decides to send — or decides not to — with
   why. It is the queue (status SCHEDULED, due at scheduledAt), and it is the
   automation log the admin reads: "Abandoned bag · Maria · triggered 14:00 ·
   scheduled 18:00 · sent" or "… · skipped: bought it in the meantime". */
export const emailJobStatusEnum = pgEnum('email_job_status', ['SCHEDULED', 'SENT', 'SKIPPED', 'CANCELLED', 'FAILED'])

export const emailJobs = pgTable(
  'email_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /* The template / automation key: 'welcome', 'abandoned_bag', 'order_shipped' … */
    automation: varchar('automation', { length: 60 }).notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    email: varchar('email', { length: 255 }).notNull(),
    recipientName: varchar('recipient_name', { length: 160 }),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    /* What the email is about: { cartId }, { orderId }, { variantId } … */
    context: jsonb('context').$type<Record<string, unknown>>().notNull().default({}),
    /* One job per thing that should only ever be emailed once —
       'order:<id>:shipped', 'abandoned_bag:<cart>:<episode>'. */
    dedupeKey: varchar('dedupe_key', { length: 160 }),
    status: emailJobStatusEnum('status').notNull().default('SCHEDULED'),
    /* When the thing happened, when the email is due, when it was handled. */
    triggeredAt: timestamp('triggered_at', { withTimezone: true }).notNull().defaultNow(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    /* Plain words: why it was triggered, and why it was skipped or failed. */
    reason: text('reason'),
    outcome: text('outcome'),
    subject: varchar('subject', { length: 300 }),
    emailLogId: uuid('email_log_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('email_jobs_dedupe_unique').on(t.dedupeKey),
    index('email_jobs_due_idx').on(t.status, t.scheduledAt),
    index('email_jobs_user_idx').on(t.userId),
    index('email_jobs_created_idx').on(t.createdAt),
  ],
)

/* -------------------------------------------------------- stock alerts -- */
/* "Notify me when it's back" requests — the storage and the trigger are in
   place (lib/automations.ts, backInStock); the button customers press is not
   built yet, so nothing writes here until it is. */
export const stockAlerts = pgTable(
  'stock_alerts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    variantId: uuid('variant_id')
      .notNull()
      .references(() => productVariants.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 255 }).notNull(),
    locale: varchar('locale', { length: 5 }).notNull().default('en'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp('notified_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('stock_alerts_variant_email_unique').on(t.variantId, sql`lower(${t.email})`),
    index('stock_alerts_pending_idx').on(t.variantId, t.notifiedAt),
  ],
)
