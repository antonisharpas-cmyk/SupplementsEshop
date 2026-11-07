/* ============================================================================
 * Partners: influencers, content creators, gyms or companies who earn a
 * commission on orders that used their promo codes.
 *
 *   A partner is an ordinary account marked as partner, with a rate.
 *   One partner can have several promo codes.
 *
 *   Commission = rate × the order's goods without VAT, after every discount
 *   (delivery is left out). Cancelled, refunded and unpaid card orders do
 *   not count.
 *
 *   Pending: the order counts, but it is not delivered yet or is still
 *   inside the return days (Settings: partner_return_days).
 *   Earned:  delivered, and the return days have passed.
 *   Owed:    everything earned, minus what was paid (partner_payouts).
 *
 * The rate is the partner's current rate, applied to every order.
 * ========================================================================== */

import { and, desc, eq, sql } from 'drizzle-orm'
import { db } from '@/db'
import { partnerPayouts, promoCodes, users } from '@/db/schema'
import { getSettings } from '@/lib/settings'

export class PartnerError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PartnerError'
  }
}

export type Period = { from?: string | null; to?: string | null }

const DAY = /^\d{4}-\d{2}-\d{2}$/
const day = (v?: string | null) => (v && DAY.test(v) ? v : null)

/* ------------------------------------------------------------ the maths -- */

/** The order counts towards commission. */
const COUNTED = sql`o.status not in ('CANCELLED', 'REFUNDED', 'PAYMENT_PENDING')
  and not (o.payment_method = 'card' and o.paid_at is null)`

/** Goods without VAT, after discounts: the total minus delivery, minus the
 *  VAT share (VAT is one rate over the whole total). */
const NET = sql`(case when o.total_cents > 0
  then round((o.total_cents - o.delivery_cents)::numeric * (o.total_cents - o.vat_cents) / o.total_cents)
  else 0 end)`

const IN_PERIOD = (p: Period) => {
  const from = day(p.from)
  const to = day(p.to)
  return sql`${from ? sql`and (o.created_at at time zone 'Europe/Nicosia')::date >= ${from}::date` : sql``}
    ${to ? sql`and (o.created_at at time zone 'Europe/Nicosia')::date <= ${to}::date` : sql``}`
}

type Totals = { orders: number; salesCents: number; commissionCents: number; earnedCents: number; pendingCents: number }

/** Per promo code of one partner, or of every partner (partnerId null). */
async function codeRows(partnerId: string | null, period: Period, returnDays: number) {
  const res = await db.execute<{
    partner_id: string
    code_id: string
    code: string
    rate_bp: number
    orders: number
    sales: number
    commission: number
    earned: number
  }>(sql`
    select pc.partner_user_id as partner_id, pc.id as code_id, pc.code, u.partner_rate_bp as rate_bp,
           count(o.id)::int as orders,
           coalesce(sum(${NET}), 0)::bigint as sales,
           coalesce(sum(round(${NET} * u.partner_rate_bp / 10000.0)), 0)::bigint as commission,
           coalesce(sum(round(${NET} * u.partner_rate_bp / 10000.0)) filter (
             where o.status = 'DELIVERED' and o.delivered_at <= now() - make_interval(days => ${returnDays})
           ), 0)::bigint as earned
    from promo_codes pc
    join users u on u.id = pc.partner_user_id
    left join orders o on o.promo_code_id = pc.id and ${COUNTED} ${IN_PERIOD(period)}
    where u.is_partner ${partnerId ? sql`and pc.partner_user_id = ${partnerId}::uuid` : sql``}
    group by pc.partner_user_id, pc.id, pc.code, u.partner_rate_bp
    order by pc.code`)
  return res.rows.map((r) => ({
    partnerId: r.partner_id,
    codeId: r.code_id,
    code: r.code,
    orders: Number(r.orders),
    salesCents: Number(r.sales),
    commissionCents: Number(r.commission),
    earnedCents: Number(r.earned),
    pendingCents: Number(r.commission) - Number(r.earned),
  }))
}

function sum(rows: Totals[]): Totals {
  return rows.reduce(
    (t, r) => ({
      orders: t.orders + r.orders,
      salesCents: t.salesCents + r.salesCents,
      commissionCents: t.commissionCents + r.commissionCents,
      earnedCents: t.earnedCents + r.earnedCents,
      pendingCents: t.pendingCents + r.pendingCents,
    }),
    { orders: 0, salesCents: 0, commissionCents: 0, earnedCents: 0, pendingCents: 0 },
  )
}

async function returnDays() {
  const { partner_return_days } = await getSettings(['partner_return_days'])
  return Math.max(0, Math.round(partner_return_days))
}

/** Earned all time minus paid all time, per partner. */
async function owedByPartner(partnerId: string | null, days: number) {
  const earned = await codeRows(partnerId, {}, days)
  const paid = await db
    .select({ userId: partnerPayouts.userId, paid: sql<number>`coalesce(sum(${partnerPayouts.amountCents}), 0)`.mapWith(Number) })
    .from(partnerPayouts)
    .where(partnerId ? eq(partnerPayouts.userId, partnerId) : undefined)
    .groupBy(partnerPayouts.userId)
  const out = new Map<string, { earnedCents: number; paidCents: number; owedCents: number }>()
  for (const r of earned) {
    const o = out.get(r.partnerId) ?? { earnedCents: 0, paidCents: 0, owedCents: 0 }
    o.earnedCents += r.earnedCents
    out.set(r.partnerId, o)
  }
  for (const p of paid) {
    const o = out.get(p.userId) ?? { earnedCents: 0, paidCents: 0, owedCents: 0 }
    o.paidCents += p.paid
    out.set(p.userId, o)
  }
  for (const o of out.values()) o.owedCents = o.earnedCents - o.paidCents
  return out
}

/* -------------------------------------------------------------- reports -- */

export type PartnerSummary = Totals & {
  id: string
  name: string
  email: string
  rateBp: number
  codes: string[]
  allTime: { earnedCents: number; paidCents: number; owedCents: number }
}

/** Every partner, with the numbers for the period and what is owed. */
export async function listPartners(period: Period): Promise<{ partners: PartnerSummary[]; returnDays: number }> {
  const days = await returnDays()
  const [people, rows, owed] = await Promise.all([
    db
      .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, rateBp: users.partnerRateBp })
      .from(users)
      .where(eq(users.isPartner, true))
      .orderBy(users.firstName),
    codeRows(null, period, days),
    owedByPartner(null, days),
  ])
  return {
    returnDays: days,
    partners: people.map((p) => {
      const mine = rows.filter((r) => r.partnerId === p.id)
      return {
        id: p.id,
        name: `${p.firstName} ${p.lastName}`.trim(),
        email: p.email,
        rateBp: p.rateBp,
        codes: mine.map((r) => r.code),
        ...sum(mine),
        allTime: owed.get(p.id) ?? { earnedCents: 0, paidCents: 0, owedCents: 0 },
      }
    }),
  }
}

/** One partner: per code for the period, what is owed, and the payments.
 *  Null when the account is not a partner. */
export async function partnerReport(userId: string, period: Period) {
  const [p] = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, rateBp: users.partnerRateBp, isPartner: users.isPartner })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!p?.isPartner) return null
  const days = await returnDays()
  const [codes, owed, payouts] = await Promise.all([
    codeRows(userId, period, days),
    owedByPartner(userId, days),
    db.select().from(partnerPayouts).where(eq(partnerPayouts.userId, userId)).orderBy(desc(partnerPayouts.paidOn), desc(partnerPayouts.createdAt)),
  ])
  return {
    partner: { id: p.id, name: `${p.firstName} ${p.lastName}`.trim(), email: p.email, rateBp: p.rateBp },
    returnDays: days,
    codes,
    totals: sum(codes),
    allTime: owed.get(userId) ?? { earnedCents: 0, paidCents: 0, owedCents: 0 },
    payouts: payouts.map((x) => ({ id: x.id, amountCents: x.amountCents, paidOn: x.paidOn, note: x.note })),
  }
}

/* -------------------------------------------------------------- changes -- */

/** Mark an account as partner (or not) with its commission, in percent. */
export async function setPartner(userId: string, input: { isPartner: boolean; ratePercent: number }) {
  const bp = Math.round(input.ratePercent * 100)
  if (!Number.isFinite(bp) || bp < 0 || bp > 5000) throw new PartnerError('Commission must be between 0% and 50%.')
  if (input.isPartner && bp === 0) throw new PartnerError('Give the partner a commission above 0%.')
  const [u] = await db
    .update(users)
    .set({ isPartner: input.isPartner, partnerRateBp: input.isPartner ? bp : 0, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning({ id: users.id })
  if (!u) throw new PartnerError('That account no longer exists.')
  /* No longer a partner: their codes stop earning for them. */
  if (!input.isPartner) await db.update(promoCodes).set({ partnerUserId: null }).where(eq(promoCodes.partnerUserId, userId))
}

/** Link promo codes to a partner. The codes keep working for customers. */
export async function setPartnerCodes(userId: string, codeIds: string[]) {
  const [p] = await db.select({ isPartner: users.isPartner }).from(users).where(eq(users.id, userId)).limit(1)
  if (!p?.isPartner) throw new PartnerError('Mark the account as partner first.')
  await db.transaction(async (tx) => {
    await tx.update(promoCodes).set({ partnerUserId: null }).where(eq(promoCodes.partnerUserId, userId))
    for (const id of codeIds) {
      await tx.update(promoCodes).set({ partnerUserId: userId }).where(eq(promoCodes.id, id))
    }
  })
}

/** Every promo code, with who it belongs to, for the picker. */
export async function codeChoices() {
  return db
    .select({ id: promoCodes.id, code: promoCodes.code, isActive: promoCodes.isActive, partnerUserId: promoCodes.partnerUserId })
    .from(promoCodes)
    .orderBy(promoCodes.code)
}

export async function recordPayout(userId: string, input: { amountCents: number; paidOn: string; note?: string | null }, by: string | null) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) throw new PartnerError('Enter the amount paid.')
  if (!DAY.test(input.paidOn)) throw new PartnerError('Enter the date it was paid.')
  const [p] = await db.select({ isPartner: users.isPartner }).from(users).where(eq(users.id, userId)).limit(1)
  if (!p?.isPartner) throw new PartnerError('That account is not a partner.')
  await db.insert(partnerPayouts).values({
    userId,
    amountCents: input.amountCents,
    paidOn: input.paidOn,
    note: input.note?.trim().slice(0, 300) || null,
    createdBy: by,
  })
}

export async function deletePayout(userId: string, payoutId: string) {
  await db.delete(partnerPayouts).where(and(eq(partnerPayouts.id, payoutId), eq(partnerPayouts.userId, userId)))
}
