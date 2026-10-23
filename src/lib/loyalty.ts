/* ============================================================================
 * Membership tiers: Basic, Performer, Elite, Champion, Pro.
 *
 * Earning
 *   A tier is earned with at least `minOrders` paid orders AND `minSpendCents`
 *   spent (after discounts, before delivery) within the last
 *   `loyalty_window_months`. The customer gets the highest tier whose rules
 *   they meet. Cancelled and refunded orders do not count.
 *
 * Keeping
 *   A tier stays while the customer keeps ordering: it is valid until
 *   `durationMonths` after their latest paid order (with
 *   `loyalty_keep_min_orders` above 1: after the order that many back). So
 *   with the defaults, a tier only ends after 6 months without any order.
 *   It then steps down ONE tier (Champion to Elite), with a fresh period at
 *   that tier, like airline and hotel programmes do. Basic never runs out.
 *
 * Staff
 *   Can set a tier by hand with an end date (Admin, Customers). Until that
 *   date the rules never lower it; after it the rules apply as usual.
 *
 * Benefit
 *   `discountPercent` comes off every price for that customer, before any
 *   promotion (lib/pricing.ts resolvePrices): €100 at Champion 12% is €88,
 *   then a 10% protein promotion makes it €79.20. Promo codes come after.
 *
 * Emails (lib/automations.ts, editable in Marketing & emails): tier earned,
 * close to the next tier, tier ending soon, tier stepped down.
 *
 * Every rule is editable in Admin, Settings, Membership tiers.
 * ========================================================================== */

import { and, desc, eq, gte, inArray, isNotNull, isNull, lt, lte, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { orders, tierEvents, users } from '@/db/schema'
import type { Locale } from '@/config/brand'
import { getSettings, SETTING_DEFAULTS, type TierKey, type TierRule } from '@/lib/settings'

export type { TierKey, TierRule }

export const TIER_KEYS: TierKey[] = ['basic', 'performer', 'elite', 'champion', 'pro']

/** The tier names are the brand's own words, the same in every language. */
export const TIER_NAMES: Record<TierKey, string> = {
  basic: 'Basic',
  performer: 'Performer',
  elite: 'Elite',
  champion: 'Champion',
  pro: 'Pro',
}

export const TIER_TAGLINES: Record<TierKey, Record<Locale, string>> = {
  basic: {
    en: 'Building a baseline fitness foundation',
    el: 'Χτίζεις τις βάσεις της φυσικής σου κατάστασης',
    ru: 'Закладываете базу физической формы',
  },
  performer: {
    en: 'Training with purpose, every week',
    el: 'Προπονείσαι με στόχο, κάθε εβδομάδα',
    ru: 'Тренируетесь с целью каждую неделю',
  },
  elite: {
    en: 'Consistency that shows in your results',
    el: 'Συνέπεια που φαίνεται στα αποτελέσματα',
    ru: 'Постоянство, которое видно по результатам',
  },
  champion: {
    en: 'Performance at a level few reach',
    el: 'Απόδοση σε επίπεδο που λίγοι φτάνουν',
    ru: 'Результаты уровня, которого достигают немногие',
  },
  pro: {
    en: 'The top of the AIONIX community',
    el: 'Η κορυφή της κοινότητας AIONIX',
    ru: 'Вершина сообщества AIONIX',
  },
}

export const isTierKey = (v: unknown): v is TierKey => typeof v === 'string' && (TIER_KEYS as string[]).includes(v)
const tierIndex = (k: string) => Math.max(0, TIER_KEYS.indexOf(k as TierKey))

/* ---------------------------------------------------------------- rules -- */

export type LoyaltyConfig = {
  enabled: boolean
  tiers: TierRule[]
  windowMonths: number
  nearGoalPercent: number
  warningDays: number
  /** The last reminder, this many days before the tier ends. */
  lastCallDays: number
  /** Paid orders within a tier period that keep the tier (default 1). */
  keepMinOrders: number
}

/** The rules as saved in Settings, always five tiers in order, sane numbers. */
export function normaliseTiers(raw: unknown): TierRule[] {
  const given = Array.isArray(raw) ? (raw as Partial<TierRule>[]) : []
  return TIER_KEYS.map((key) => {
    const fallback = SETTING_DEFAULTS.loyalty_tiers.find((t) => t.key === key)!
    const t = given.find((g) => g?.key === key) ?? fallback
    const int = (v: unknown, d: number, max: number) => {
      const n = Math.round(Number(v))
      return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : d
    }
    return {
      key,
      discountPercent: key === 'basic' ? 0 : Math.min(90, Math.max(0, Number(t.discountPercent) || 0)),
      minOrders: key === 'basic' ? 0 : int(t.minOrders, fallback.minOrders, 10_000),
      minSpendCents: key === 'basic' ? 0 : int(t.minSpendCents, fallback.minSpendCents, 100_000_000),
      durationMonths: int(t.durationMonths, fallback.durationMonths, 60) || 1,
    }
  })
}

export async function loyaltyConfig(): Promise<LoyaltyConfig> {
  const s = await getSettings([
    'loyalty_enabled',
    'loyalty_tiers',
    'loyalty_window_months',
    'loyalty_near_goal_percent',
    'loyalty_warning_days',
    'loyalty_last_call_days',
    'loyalty_keep_min_orders',
  ])
  return {
    enabled: s.loyalty_enabled,
    tiers: normaliseTiers(s.loyalty_tiers),
    windowMonths: Math.max(1, Math.round(s.loyalty_window_months) || 6),
    nearGoalPercent: Math.min(99, Math.max(1, Math.round(s.loyalty_near_goal_percent) || 80)),
    warningDays: Math.max(1, Math.round(s.loyalty_warning_days) || 14),
    lastCallDays: Math.max(1, Math.round(s.loyalty_last_call_days) || 2),
    keepMinOrders: Math.min(100, Math.max(1, Math.round(s.loyalty_keep_min_orders) || 1)),
  }
}

const addMonths = (d: Date, n: number) => {
  const x = new Date(d)
  x.setMonth(x.getMonth() + n)
  return x
}

/* ---------------------------------------------------------------- stats -- */

export type TierStats = { orders: number; spendCents: number; since: Date }

/** Paid orders and spend within the window. */
export async function tierStats(userId: string, windowMonths: number, now = new Date()): Promise<TierStats> {
  const since = addMonths(now, -windowMonths)
  const [row] = await db
    .select({
      orders: sql<number>`count(*)`.mapWith(Number),
      spend: sql<number>`coalesce(sum(${orders.totalCents} - ${orders.deliveryCents}), 0)`.mapWith(Number),
    })
    .from(orders)
    .where(
      and(
        eq(orders.userId, userId),
        isNotNull(orders.paidAt),
        gte(orders.paidAt, since),
        sql`${orders.status} not in ('CANCELLED', 'REFUNDED')`,
      ),
    )
  return { orders: row?.orders ?? 0, spendCents: Math.max(0, row?.spend ?? 0), since }
}

/**
 * Until when the customer's orders keep a tier: `durationMonths` after their
 * latest paid order (or the `keepMin`th latest). Null without such orders.
 */
export async function keptUntil(userId: string, keepMin: number, durationMonths: number): Promise<Date | null> {
  const rows = await db
    .select({ paidAt: orders.paidAt })
    .from(orders)
    .where(and(eq(orders.userId, userId), isNotNull(orders.paidAt), sql`${orders.status} not in ('CANCELLED', 'REFUNDED')`))
    .orderBy(desc(orders.paidAt))
    .limit(keepMin)
  const nth = rows[keepMin - 1]?.paidAt
  return nth ? addMonths(nth, durationMonths) : null
}

/** The highest tier whose rules the stats meet. */
export function qualifiedTier(tiers: TierRule[], stats: TierStats): TierKey {
  let best: TierKey = 'basic'
  for (const t of tiers) {
    if (stats.orders >= t.minOrders && stats.spendCents >= t.minSpendCents) best = t.key
  }
  return best
}

/** How far the stats are towards a tier: 0 to 1, the lower of the two rules. */
export function progressTowards(rule: TierRule, stats: TierStats) {
  const ordersShare = rule.minOrders > 0 ? Math.min(1, stats.orders / rule.minOrders) : 1
  const spendShare = rule.minSpendCents > 0 ? Math.min(1, stats.spendCents / rule.minSpendCents) : 1
  return {
    share: Math.min(ordersShare, spendShare),
    ordersShare,
    spendShare,
    ordersNeeded: Math.max(0, rule.minOrders - stats.orders),
    spendNeededCents: Math.max(0, rule.minSpendCents - stats.spendCents),
  }
}

/* ------------------------------------------------------- the customer's -- */

export type CustomerTier = {
  enabled: boolean
  tier: TierKey
  rule: TierRule
  since: Date | null
  expiresAt: Date | null
  manualUntil: Date | null
  stats: TierStats
  next: (TierRule & { progress: ReturnType<typeof progressTowards> }) | null
  /** What keeping the current tier needs: this many new paid orders before
   *  `expiresAt` (each one moves the end date on). Null at Basic. */
  keep: { ordersNeeded: number; spendNeededCents: 0 } | null
  /** The tier they step down to when it runs out without the rules met. */
  lower: TierRule | null
  config: LoyaltyConfig
}

export async function customerTier(userId: string, now = new Date()): Promise<CustomerTier | null> {
  const [u] = await db
    .select({ tier: users.tier, since: users.tierSince, expiresAt: users.tierExpiresAt, manualUntil: users.tierManualUntil, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
  if (!u || u.role !== 'CUSTOMER') return null
  const config = await loyaltyConfig()
  const tier = isTierKey(u.tier) ? u.tier : 'basic'
  const idx = tierIndex(tier)
  const rule = config.tiers[idx]
  const stats = await tierStats(userId, config.windowMonths, now)
  const nextRule = config.tiers[idx + 1] ?? null
  return {
    enabled: config.enabled,
    tier,
    rule,
    since: u.since,
    expiresAt: idx === 0 ? null : u.expiresAt,
    manualUntil: u.manualUntil && u.manualUntil > now ? u.manualUntil : null,
    stats,
    next: nextRule ? { ...nextRule, progress: progressTowards(nextRule, stats) } : null,
    keep: idx > 0 ? { ordersNeeded: config.keepMinOrders, spendNeededCents: 0 } : null,
    lower: idx > 0 ? config.tiers[idx - 1] : null,
    config,
  }
}

/** The discount a signed in customer sees on every price, in percent. */
export async function tierDiscountPercent(userId: string | null | undefined): Promise<{ tier: TierKey; percent: number }> {
  if (!userId) return { tier: 'basic', percent: 0 }
  const [u] = await db.select({ tier: users.tier, role: users.role }).from(users).where(eq(users.id, userId))
  if (!u || u.role !== 'CUSTOMER') return { tier: 'basic', percent: 0 }
  const config = await loyaltyConfig()
  if (!config.enabled) return { tier: 'basic', percent: 0 }
  const tier = isTierKey(u.tier) ? u.tier : 'basic'
  return { tier, percent: config.tiers[tierIndex(tier)].discountPercent }
}

/** For pages: the tier of whoever is looking (Basic, 0% for guests and staff). */
export async function viewerTier(): Promise<{ tier: TierKey; percent: number }> {
  try {
    const { getCurrentUser } = await import('@/lib/auth/session')
    const user = await getCurrentUser()
    return await tierDiscountPercent(user?.id)
  } catch {
    /* Outside a request (emails, scripts): list prices. */
    return { tier: 'basic', percent: 0 }
  }
}

/* ----------------------------------------------------------- evaluation -- */

type Notify = (
  key: 'tier_upgraded' | 'tier_near' | 'tier_expiring' | 'tier_last_call' | 'tier_downgraded',
  userId: string,
  dedupe: string,
  vars: Record<string, string>,
) => Promise<void>

async function defaultNotify(...args: Parameters<Notify>) {
  const { scheduleTierEmail } = await import('@/lib/automations')
  await scheduleTierEmail(...args)
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10)

/**
 * Bring one customer's tier up to date and send whatever email that calls
 * for. Safe to run any number of times: emails are deduplicated.
 */
export async function evaluateTier(userId: string, opts: { now?: Date; notify?: Notify | null } = {}) {
  const now = opts.now ?? new Date()
  const notify = opts.notify === undefined ? defaultNotify : opts.notify
  const config = await loyaltyConfig()
  const [u] = await db.select().from(users).where(eq(users.id, userId))
  if (!u || u.role !== 'CUSTOMER') return null
  if (!config.enabled) {
    await db.update(users).set({ tierCheckedAt: now }).where(eq(users.id, userId))
    return u.tier
  }

  const tiers = config.tiers
  let tier: TierKey = isTierKey(u.tier) ? u.tier : 'basic'
  let expiresAt = u.tierExpiresAt
  let since = u.tierSince
  let manualUntil = u.tierManualUntil
  const events: { from: TierKey; to: TierKey; reason: string; note?: string }[] = []
  const mails: Parameters<Notify>[] = []

  /* Set by staff and still running: the rules do not lower it. */
  if (manualUntil && manualUntil > now) {
    await db.update(users).set({ tierCheckedAt: now }).where(eq(users.id, userId))
    return tier
  }
  /* A staff tier that has ended: from now the rules apply, starting from its end. */
  if (manualUntil) {
    events.push({ from: tier, to: tier, reason: 'manual_ended' })
    expiresAt = manualUntil
    manualUntil = null
  }

  const stats = await tierStats(userId, config.windowMonths, now)
  const earned = qualifiedTier(tiers, stats)
  const idx = tierIndex(tier)
  const earnedIdx = tierIndex(earned)

  if (earnedIdx > idx) {
    /* Up: straight to the highest tier the rules give. */
    events.push({ from: tier, to: earned, reason: 'earned' })
    tier = earned
    since = now
    expiresAt = addMonths(now, tiers[earnedIdx].durationMonths)
    mails.push(['tier_upgraded', userId, `tier_upgraded:${userId}:${earned}:${dayKey(now)}`, {}])
  } else if (idx > 0) {
    /* Every order keeps the tier for another period from that order. */
    const kept = await keptUntil(userId, config.keepMinOrders, tiers[idx].durationMonths)
    if (!expiresAt) expiresAt = kept && kept > now ? kept : addMonths(now, tiers[idx].durationMonths)
    if (kept && kept > expiresAt) expiresAt = kept
    if (expiresAt <= now) {
      /* A whole period without an order: one tier down, with a fresh period. */
      const lower = TIER_KEYS[idx - 1]
      events.push({ from: tier, to: lower, reason: 'stepped_down' })
      mails.push(['tier_downgraded', userId, `tier_downgraded:${userId}:${tier}:${dayKey(now)}`, { old_tier: TIER_NAMES[tier] }])
      tier = lower
      since = now
      expiresAt = idx - 1 > 0 ? addMonths(now, tiers[idx - 1].durationMonths) : null
    } else if (expiresAt.getTime() - now.getTime() <= config.lastCallDays * 86_400_000) {
      /* The last reminder, a couple of days before it ends. */
      mails.push(['tier_last_call', userId, `tier_last_call:${userId}:${tier}:${dayKey(expiresAt)}`, {}])
    } else if (expiresAt.getTime() - now.getTime() <= config.warningDays * 86_400_000) {
      mails.push(['tier_expiring', userId, `tier_expiring:${userId}:${tier}:${dayKey(expiresAt)}`, {}])
    }
  }
  if (tier === 'basic') expiresAt = null

  /* Close to the next tier: one email per tier per window. */
  const nextIdx = tierIndex(tier) + 1
  if (nextIdx < tiers.length) {
    const p = progressTowards(tiers[nextIdx], stats)
    if (p.share >= config.nearGoalPercent / 100 && p.share < 1) {
      const bucket = Math.floor(now.getTime() / (config.windowMonths * 30 * 86_400_000))
      mails.push(['tier_near', userId, `tier_near:${userId}:${tiers[nextIdx].key}:${bucket}`, {}])
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ tier, tierSince: since, tierExpiresAt: expiresAt, tierManualUntil: manualUntil, tierCheckedAt: now, updatedAt: now })
      .where(eq(users.id, userId))
    for (const e of events) {
      await tx.insert(tierEvents).values({ userId, fromTier: e.from, toTier: e.to, reason: e.reason, note: e.note ?? null })
    }
  })
  if (notify) for (const m of mails) await notify(...m).catch((err) => console.error('[loyalty] email not scheduled', err))
  return tier
}

/** Staff set a tier by hand, kept until `until` (then the rules apply). */
export async function setTierManually(args: { userId: string; tier: TierKey; until: Date; by: string; note?: string }) {
  const [u] = await db.select({ tier: users.tier, role: users.role }).from(users).where(eq(users.id, args.userId))
  if (!u || u.role !== 'CUSTOMER') throw new Error('Only customer accounts have a tier.')
  const now = new Date()
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ tier: args.tier, tierSince: now, tierManualUntil: args.until, tierExpiresAt: args.tier === 'basic' ? null : args.until, tierCheckedAt: now, updatedAt: now })
      .where(eq(users.id, args.userId))
    await tx.insert(tierEvents).values({
      userId: args.userId,
      fromTier: u.tier,
      toTier: args.tier,
      reason: 'manual',
      note: args.note?.trim().slice(0, 500) || null,
      byUserId: args.by,
    })
  })
}

/** Staff hand the tier back to the rules straight away. */
export async function clearManualTier(userId: string, by: string) {
  const [u] = await db.select({ tier: users.tier, manualUntil: users.tierManualUntil }).from(users).where(eq(users.id, userId))
  if (!u?.manualUntil) return
  const now = new Date()
  await db.update(users).set({ tierManualUntil: now }).where(eq(users.id, userId))
  await db.insert(tierEvents).values({ userId, fromTier: u.tier, toTier: u.tier, reason: 'manual', note: 'Handed back to the rules.', byUserId: by })
  await evaluateTier(userId, { now })
}

export async function tierHistory(userId: string) {
  return db.select().from(tierEvents).where(eq(tierEvents.userId, userId)).orderBy(desc(tierEvents.createdAt)).limit(50)
}

/** The automation clock: customers whose tier ends soon or has ended, staff
 *  tiers that have ended, and anyone never checked (so existing customers get
 *  the tier their past orders earn). */
export async function sweepTiers(now = new Date(), limit = 100) {
  const config = await loyaltyConfig()
  if (!config.enabled) return 0
  const soon = new Date(now.getTime() + config.warningDays * 86_400_000)
  const recheck = new Date(now.getTime() - 6 * 3600_000)
  const due = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.role, 'CUSTOMER'),
        eq(users.isActive, true),
        or(
          isNull(users.tierCheckedAt),
          and(lte(users.tierManualUntil, now)),
          and(lte(users.tierExpiresAt, soon), lt(users.tierCheckedAt, recheck)),
        ),
      ),
    )
    .limit(limit)
  let n = 0
  for (const d of due) {
    try {
      await evaluateTier(d.id, { now })
      n++
    } catch (err) {
      console.error('[loyalty] evaluation failed', d.id, err)
    }
  }
  return n
}

/** Counts per tier, for the admin. */
export async function tierCounts() {
  const rows = await db
    .select({ tier: users.tier, n: sql<number>`count(*)`.mapWith(Number) })
    .from(users)
    .where(and(eq(users.role, 'CUSTOMER'), inArray(users.tier, TIER_KEYS)))
    .groupBy(users.tier)
  return Object.fromEntries(TIER_KEYS.map((k) => [k, rows.find((r) => r.tier === k)?.n ?? 0])) as Record<TierKey, number>
}
