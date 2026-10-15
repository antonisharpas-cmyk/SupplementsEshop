/* Every payment on the customer's orders: card payments with their brand and
   last four digits, cash payments when received, refunds. */

import Link from 'next/link'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator, type MessageKey } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { listPaymentsForUser } from '@/lib/orders'
import { formatMoney } from '@/lib/pricing'
import { formatDate } from '@/components/account/OrderView'

export const metadata: Metadata = { title: 'Payments', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function PaymentsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const rows = await listPaymentsForUser(user.id)

  return (
    <div>
      <h1 className="text-2xl font-semibold tracking-tight">{t('acc.payments')}</h1>
      {rows.length === 0 ? (
        <p className="mt-6 border border-dashed border-line px-6 py-12 text-center text-sm text-muted">{t('acc.noPayments')}</p>
      ) : (
        <div className="mt-6 overflow-x-auto border border-line">
          <table className="w-full min-w-[36rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="label px-4 py-3 text-muted">{t('acc.date')}</th>
                <th className="label px-4 py-3 text-muted">{t('acc.order')}</th>
                <th className="label px-4 py-3 text-muted">{t('acc.method')}</th>
                <th className="label px-4 py-3 text-muted">{t('acc.statusCol')}</th>
                <th className="label px-4 py-3 text-right text-muted">{t('acc.amount')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)]">
              {rows.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3 whitespace-nowrap">{formatDate(p.paidAt ?? p.createdAt, locale)}</td>
                  <td className="px-4 py-3">
                    <Link href={`/${locale}/account/orders/${p.orderNumber}`} className="font-mono text-heading hover:underline">
                      {p.orderNumber}
                    </Link>
                  </td>
                  <td className="px-4 py-3">
                    {p.provider === 'stripe' ? t('pm.card') : t('pm.cod')}
                    {p.cardBrand && p.cardLast4 && (
                      <span className="block text-xs text-muted">{t('ord.cardEnding', { brand: p.cardBrand.toUpperCase(), last4: p.cardLast4 })}</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <span className={p.status === 'SUCCEEDED' ? 'text-ok' : p.status.includes('REFUND') ? 'text-accent' : 'text-muted'}>
                      {t(`ps.${p.status}` as MessageKey)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-heading">
                    {formatMoney(p.amountCents, locale, p.currency)}
                    {p.refundedCents > 0 && (
                      <span className="block text-xs text-muted">−{formatMoney(p.refundedCents, locale, p.currency)}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
