/* A partner's own results: their promo codes, orders, sales and commission
   for the period they choose, and what has been paid. No customer details. */

import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { partnerReport } from '@/lib/partners'
import { readPeriod } from '@/lib/period'
import { formatMoney } from '@/lib/pricing'
import { PeriodFilter } from '@/components/PeriodFilter'

export const metadata: Metadata = { title: 'My results', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>

function Box({ label, value, strong }: { label: string; value: string | number; strong?: boolean }) {
  return (
    <div className={`rounded-2xl border p-4 ${strong ? 'border-accent/60 bg-accent/5' : 'border-line bg-paper-2'}`}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums text-heading">{value}</p>
    </div>
  )
}

export default async function PartnerResultsPage({ params, searchParams }: { params: Promise<{ locale: string }>; searchParams: Promise<SP> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const period = readPeriod(await searchParams)
  const r = await partnerReport(user.id, period)
  if (!r) redirect(`/${locale}/account/orders`)
  const money = (c: number) => formatMoney(c, locale)

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight text-heading">{t('partner.title')}</h1>
      <p className="mt-1 mb-6 text-sm text-muted">{t('partner.sub', { rate: `${r.partner.rateBp / 100}%` })}</p>

      <PeriodFilter path={`/${locale}/account/partner`} period={period} locale={locale} />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Box label={t('partner.orders')} value={r.totals.orders} />
        <Box label={t('partner.sales')} value={money(r.totals.salesCents)} />
        <Box label={t('partner.commission')} value={money(r.totals.commissionCents)} />
        <Box label={t('partner.pending')} value={money(r.totals.pendingCents)} />
      </div>

      {r.codes.length === 0 ? (
        <p className="mt-6 text-sm text-muted">{t('partner.none')}</p>
      ) : (
        <div className="mt-6 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs text-muted">
                <th className="px-4 py-3">{t('partner.code')}</th>
                <th className="px-4 py-3 text-right">{t('partner.orders')}</th>
                <th className="px-4 py-3 text-right">{t('partner.sales')}</th>
                <th className="px-4 py-3 text-right">{t('partner.commission')}</th>
                <th className="px-4 py-3 text-right">{t('partner.pending')}</th>
                <th className="px-4 py-3 text-right">{t('partner.earned')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {r.codes.map((c) => (
                <tr key={c.codeId}>
                  <td className="px-4 py-3 font-mono">{c.code}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.orders}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(c.salesCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(c.commissionCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{money(c.pendingCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{money(c.earnedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Box label={t('partner.earned')} value={money(r.allTime.earnedCents)} />
        <Box label={t('partner.paid')} value={money(r.allTime.paidCents)} />
        <Box label={t('partner.owed')} value={money(Math.max(0, r.allTime.owedCents))} strong />
      </div>
      <p className="mt-3 text-xs text-muted">{t('partner.note', { days: r.returnDays })}</p>
    </div>
  )
}
