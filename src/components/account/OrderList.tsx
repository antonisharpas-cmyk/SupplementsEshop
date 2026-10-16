/* A customer's orders as cards: number, date, status, items, total. */

import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { formatMoney } from '@/lib/pricing'
import type { OrderSummary } from '@/lib/orders'
import { StatusPill, formatDate } from './OrderView'

/** Orders still on their way to the customer; everything else is past. */
export const CURRENT_STATUSES = ['PENDING', 'PAYMENT_PENDING', 'PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED']

export function OrderList({ orders, locale }: { orders: OrderSummary[]; locale: Locale }) {
  const t = getTranslator(locale)
  return (
    <ul className="space-y-3">
      {orders.map((o) => (
        <li key={o.id}>
          <Link
            href={`/${locale}/account/orders/${o.orderNumber}`}
            className="flex items-center gap-4 rounded-2xl border border-line bg-paper-2 p-4 transition-colors hover:border-accent"
          >
            <span className="h-16 w-14 shrink-0 overflow-hidden rounded-xl bg-paper">
              {o.firstImage && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img src={o.firstImage} alt="" className="h-full w-full object-cover" />
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-heading">{o.orderNumber}</span>
                <StatusPill status={o.status} locale={locale} />
              </span>
              <span className="mt-1 block text-xs text-muted">
                {formatDate(o.createdAt, locale)} · {t('acc.items', { n: o.itemCount })}
              </span>
            </span>
            <span className="text-sm font-semibold tabular-nums text-heading">{formatMoney(o.totalCents, locale, o.currency)}</span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
