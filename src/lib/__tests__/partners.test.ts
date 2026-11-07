/* Partners against a real database: commission on goods without VAT after
   discounts, pending until the return days pass, and owed minus payouts. */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from 'drizzle-orm'
import { db, pool } from '@/db'
import { orders, promoCodes, users } from '@/db/schema'
import { setSetting, invalidateSettingsCache } from '../settings'
import { listPartners, partnerReport, recordPayout, setPartner, setPartnerCodes } from '../partners'

let partnerId = ''
let codeA = ''
let codeB = ''
const DAY = 86_400_000

beforeEach(async () => {
  await db.execute(sql`truncate table partner_payouts, promo_code_usage, orders, promo_codes, users restart identity cascade`)
  await setSetting('partner_return_days', 14)
  invalidateSettingsCache()
  const [u] = await db
    .insert(users)
    .values({ email: 'eleni@example.com', passwordHash: 'x', firstName: 'Eleni', lastName: 'Fit', phone: '+35799000000', emailVerifiedAt: new Date() })
    .returning({ id: users.id })
  partnerId = u.id
  const codes = await db
    .insert(promoCodes)
    .values([
      { code: 'ELENI10', discountType: 'PERCENTAGE', discountValue: 10 },
      { code: 'ELENIGYM', discountType: 'PERCENTAGE', discountValue: 5 },
    ])
    .returning({ id: promoCodes.id })
  codeA = codes[0].id
  codeB = codes[1].id
})

afterAll(async () => {
  await pool.end()
})

/** A €119 order with €4 delivery, 19% VAT on the whole total. */
async function order(codeId: string, opts: { status?: 'PAID' | 'DELIVERED' | 'CANCELLED' | 'PENDING'; deliveredDaysAgo?: number; method?: 'card' | 'cod'; paid?: boolean } = {}) {
  const status = opts.status ?? 'DELIVERED'
  await db.insert(orders).values({
    orderNumber: `AX-${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
    email: 'buyer@example.com',
    phone: '+35799111222',
    customerName: 'Buyer',
    status,
    paymentMethod: opts.method ?? 'card',
    paidAt: opts.paid === false ? null : new Date(),
    deliveryKind: 'SHIPPING',
    subtotalCents: 11500,
    deliveryCents: 400,
    totalCents: 11900,
    vatCents: 1900,
    promoCodeId: codeId,
    deliveredAt: status === 'DELIVERED' ? new Date(Date.now() - (opts.deliveredDaysAgo ?? 30) * DAY) : null,
    locale: 'en',
  })
}

describe('partners', () => {
  it('counts goods without VAT after discounts, pending until the return days pass, across several codes', async () => {
    await setPartner(partnerId, { isPartner: true, ratePercent: 10 })
    await setPartnerCodes(partnerId, [codeA, codeB])
    await order(codeA) /* delivered 30 days ago: earned */
    await order(codeB, { deliveredDaysAgo: 3 }) /* still inside 14 days: pending */
    await order(codeA, { status: 'PAID' }) /* not delivered yet: pending */
    await order(codeA, { status: 'CANCELLED' }) /* never counts */
    await order(codeA, { status: 'PENDING', paid: false }) /* unpaid card order: never counts */
    await order(codeA, { status: 'PENDING', method: 'cod', paid: false }) /* cash order: pending */

    const r = (await partnerReport(partnerId, {}))!
    /* (11900 - 400) × 10000 / 11900 = 9664 net per order, 966 commission. */
    expect(r.totals.orders).toBe(4)
    expect(r.totals.salesCents).toBe(4 * 9664)
    expect(r.totals.commissionCents).toBe(4 * 966)
    expect(r.totals.earnedCents).toBe(966)
    expect(r.totals.pendingCents).toBe(3 * 966)
    expect(r.codes.map((c) => [c.code, c.orders])).toEqual([
      ['ELENI10', 3],
      ['ELENIGYM', 1],
    ])
  })

  it('owed is earned minus paid, and the period filter uses the order date', async () => {
    await setPartner(partnerId, { isPartner: true, ratePercent: 7.5 })
    await setPartnerCodes(partnerId, [codeA])
    await order(codeA)
    await order(codeA)
    await recordPayout(partnerId, { amountCents: 1000, paidOn: '2026-11-01' }, null)
    const { partners } = await listPartners({})
    expect(partners[0].allTime).toEqual({ earnedCents: 2 * 725, paidCents: 1000, owedCents: 2 * 725 - 1000 })
    const future = (await partnerReport(partnerId, { from: '2099-01-01' }))!
    expect(future.totals.orders).toBe(0)
  })

  it('a partner who stops being one loses their codes, and plain accounts have no report', async () => {
    await setPartner(partnerId, { isPartner: true, ratePercent: 5 })
    await setPartnerCodes(partnerId, [codeA])
    await setPartner(partnerId, { isPartner: false, ratePercent: 0 })
    expect(await partnerReport(partnerId, {})).toBeNull()
    const [c] = await db.select().from(promoCodes).where(sql`${promoCodes.id} = ${codeA}::uuid`)
    expect(c.partnerUserId).toBeNull()
    await expect(setPartner(partnerId, { isPartner: true, ratePercent: 0 })).rejects.toThrow(/above 0%/)
  })
})
