/* ============================================================================
 * Runtime settings — the values spec sections 14 and 31 require to be
 * admin-editable rather than hardcoded.
 *
 * Every read falls back to a default, so a missing row can never take the shop
 * down. Writes go through the admin panel and are audited.
 * ========================================================================== */

import { eq, inArray } from 'drizzle-orm'
import { db } from '@/db'
import { settings } from '@/db/schema'

/* NOT `as const`: the literal types it produces would make
   setSetting('free_delivery_threshold_cents', 6000) a type error, because the
   parameter would be narrowed to exactly 5000. The shape is declared
   explicitly below instead, which keeps per-key value types without freezing
   them to the default value. */
export const SETTING_DEFAULTS: {
  free_delivery_threshold_cents: number
  reservation_ttl_seconds: number
  vat_rate_bp: number
  low_stock_threshold: number
  max_qty_per_line: number
  currency: string
  estimated_delivery_min_days: number
  estimated_delivery_max_days: number
  homepage_promotions_enabled: boolean
  order_number_prefix: string
  support_email: string
  support_idle_minutes: number
  support_auto_reply_enabled: boolean
  support_auto_reply_en: string
  support_auto_reply_el: string
  support_auto_reply_ru: string
  support_ai_enabled: boolean
  support_ai_notes: string
  marketing_cooldown_hours: number
  email_test_address: string
  company_legal_name: string
  company_vat_number: string
  company_tax_id: string
  company_address: string
  invoice_footer: string
  loyalty_enabled: boolean
  loyalty_tiers: TierRule[]
  loyalty_window_months: number
  loyalty_near_goal_percent: number
  loyalty_warning_days: number
  loyalty_last_call_days: number
  loyalty_keep_min_orders: number
  /* Finance: the last month closed for the accountant (YYYY-MM), '' for none. */
  books_closed_through: string
} = {
  /* Free delivery over this amount, in cents. Section 14: NOT hardcoded —
     this is only the value used before an admin has ever saved one. */
  free_delivery_threshold_cents: 5000,

  /* How long a cart holds stock before it is returned to the shelf.
     Section 12 asks for 5–10 minutes; 10 is friendlier on a slow checkout. */
  reservation_ttl_seconds: 600,

  /* Cyprus standard rate. Prices are VAT-inclusive, as EU consumer law
     requires, so VAT is extracted from the total rather than added. */
  vat_rate_bp: 1900, // basis points, so 19% is exact integer arithmetic

  low_stock_threshold: 3,
  max_qty_per_line: 20,
  currency: 'EUR',

  /* Shown on the product page and in the order confirmation. */
  estimated_delivery_min_days: 2,
  estimated_delivery_max_days: 4,

  /* Section 2: the admin can switch homepage promotion banners off entirely
     without deleting the promotions themselves. */
  homepage_promotions_enabled: true,

  order_number_prefix: 'AX',
  /* Where "a customer started a conversation" emails go. Empty means the
     shop's public contact address in src/config/brand.ts. */
  support_email: '',
  /* A support conversation with no new message for this long closes itself,
     and the customer is emailed the transcript. */
  support_idle_minutes: 10,
  /* The automatic first reply in the chat, in each language. */
  support_auto_reply_enabled: true,
  support_auto_reply_en:
    'Hello! Thank you for contacting AIONIX Customer Service. Someone from our team will reply as soon as possible.',
  support_auto_reply_el:
    'Γεια σου! Ευχαριστούμε που επικοινώνησες με την Εξυπηρέτηση Πελατών AIONIX. Κάποιος από την ομάδα μας θα σου απαντήσει το συντομότερο.',
  support_auto_reply_ru:
    'Здравствуйте! Спасибо, что обратились в службу поддержки AIONIX. Сотрудник нашей команды ответит вам как можно скорее.',
  /* The AI assistant in the chat answers first (needs ANTHROPIC_API_KEY);
     off means people answer everything, as before. */
  support_ai_enabled: true,
  /* Anything the owner wants the assistant to know: offers, rules, answers
     to common questions. Plain text. */
  support_ai_notes: '',
  /* Frequency protection: at most one marketing email (abandoned bag,
     newsletter, promotion) to an address within this many hours. 0 = off. */
  marketing_cooldown_hours: 20,
  /* Where "Send test email" goes — and the only address it can go to. */
  email_test_address: '',

  /* Printed on every invoice. Copied into each invoice when it is issued, so
     a later change only affects invoices issued after it. */
  company_legal_name: '',
  company_vat_number: '',
  company_tax_id: '',
  /* One line per row of the address. */
  company_address: '',
  invoice_footer: 'Thank you for shopping with AIONIX.',

  /* Membership tiers (lib/loyalty.ts). A tier is earned with at least
     minOrders paid orders AND minSpendCents spent (after discounts, before
     delivery) within the last loyalty_window_months. It is kept while the
     customer orders: it lasts durationMonths from their latest paid order
     (loyalty_keep_min_orders back). A whole period with no order and it
     steps down one tier. discountPercent comes off every price for that
     customer, before any promotion. Basic is everyone's starting tier. */
  loyalty_enabled: true,
  loyalty_tiers: [
    { key: 'basic', discountPercent: 0, minOrders: 0, minSpendCents: 0, durationMonths: 6 },
    { key: 'performer', discountPercent: 5, minOrders: 2, minSpendCents: 15000, durationMonths: 6 },
    { key: 'elite', discountPercent: 8, minOrders: 4, minSpendCents: 40000, durationMonths: 6 },
    { key: 'champion', discountPercent: 12, minOrders: 8, minSpendCents: 90000, durationMonths: 6 },
    { key: 'pro', discountPercent: 15, minOrders: 15, minSpendCents: 200000, durationMonths: 6 },
  ],
  loyalty_window_months: 6,
  /* "You're close" email once a customer has this much of the next tier. */
  loyalty_near_goal_percent: 80,
  /* "Your tier ends soon" email this many days before stepping down. */
  loyalty_warning_days: 14,
  /* The last "your tier ends" email, this many days before. */
  loyalty_last_call_days: 2,
  /* Paid orders within a tier period that keep the tier. */
  loyalty_keep_min_orders: 1,

  /* Purchases, expenses and wholesale sales dated in a closed month cannot
     be added or changed, so the pack sent to the accountant stays true. */
  books_closed_through: '',
}

export type TierKey = 'basic' | 'performer' | 'elite' | 'champion' | 'pro'
export type TierRule = {
  key: TierKey
  discountPercent: number
  minOrders: number
  minSpendCents: number
  durationMonths: number
}

export type SettingKey = keyof typeof SETTING_DEFAULTS
export type SettingValue<K extends SettingKey> = (typeof SETTING_DEFAULTS)[K]

/* Short-lived process cache. Settings change rarely and are read on nearly
   every request, so this removes a query per page without making an admin
   wait more than a few seconds to see their change. */
const CACHE_TTL_MS = 10_000
let cache: { at: number; values: Partial<Record<SettingKey, unknown>> } = { at: 0, values: {} }

export function invalidateSettingsCache() {
  cache = { at: 0, values: {} }
}

async function loadAll(): Promise<Partial<Record<SettingKey, unknown>>> {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.values
  const rows = await db.select().from(settings)
  const values: Partial<Record<SettingKey, unknown>> = {}
  for (const row of rows) {
    if (row.key in SETTING_DEFAULTS) values[row.key as SettingKey] = row.value
  }
  cache = { at: Date.now(), values }
  return values
}

export async function getSetting<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
  const all = await loadAll()
  const raw = all[key]
  if (raw === undefined || raw === null) return SETTING_DEFAULTS[key]

  /* Guard against a bad admin save or a hand-edited row putting a string where
     a number belongs — the free-delivery threshold reaching the pricing code as
     "50" instead of 5000 would be a silent revenue bug. */
  const expected = typeof SETTING_DEFAULTS[key]
  if (typeof raw !== expected) {
    console.error(
      `[settings] ${key} is ${typeof raw} but should be ${expected}; using the default`,
    )
    return SETTING_DEFAULTS[key]
  }
  return raw as SettingValue<K>
}

export async function getSettings<K extends SettingKey>(
  keys: readonly K[],
): Promise<{ [P in K]: SettingValue<P> }> {
  const all = await loadAll()
  const out = {} as { [P in K]: SettingValue<P> }
  for (const key of keys) {
    const raw = all[key]
    out[key] =
      raw !== undefined && raw !== null && typeof raw === typeof SETTING_DEFAULTS[key]
        ? (raw as SettingValue<K>)
        : SETTING_DEFAULTS[key]
  }
  return out
}

export async function setSetting<K extends SettingKey>(
  key: K,
  value: SettingValue<K>,
  actorId?: string,
) {
  if (typeof value !== typeof SETTING_DEFAULTS[key]) {
    throw new Error(`Setting ${key} must be a ${typeof SETTING_DEFAULTS[key]}`)
  }
  await db
    .insert(settings)
    .values({ key, value, updatedBy: actorId ?? null })
    .onConflictDoUpdate({
      target: settings.key,
      set: { value, updatedBy: actorId ?? null, updatedAt: new Date() },
    })
  invalidateSettingsCache()
}

/** Seeds any setting that has never been saved, so the admin UI has rows to
 *  edit rather than empty inputs. Safe to run repeatedly. */
export async function seedMissingSettings() {
  const keys = Object.keys(SETTING_DEFAULTS) as SettingKey[]
  const existing = await db
    .select({ key: settings.key })
    .from(settings)
    .where(inArray(settings.key, keys))
  const have = new Set(existing.map((r) => r.key))
  const missing = keys.filter((k) => !have.has(k))
  if (missing.length === 0) return 0
  await db.insert(settings).values(
    missing.map((key) => ({ key, value: SETTING_DEFAULTS[key] as unknown as object })),
  )
  invalidateSettingsCache()
  return missing.length
}

export async function deleteSetting(key: SettingKey) {
  await db.delete(settings).where(eq(settings.key, key))
  invalidateSettingsCache()
}
