/* The message at the top of an order page: thanks after placing it, or what
   happened with the payment. */

import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

export function OrderBanner({
  locale,
  sp,
  order,
  paidNow,
}: {
  locale: Locale
  sp: Record<string, string | undefined>
  order: { orderNumber: string; email: string; customerName: string; status: string; paymentMethod: string }
  paidNow: boolean
}) {
  const t = getTranslator(locale)
  const name = order.customerName.split(' ')[0]
  let tone: 'ok' | 'warn' = 'ok'
  let title: string | null = null
  let body: string | null = null

  if (paidNow || (sp.session_id && order.status === 'PAID')) {
    title = t('ord.thanks', { name })
    body = t('ord.placedPaid', { number: order.orderNumber, email: order.email })
  } else if (sp.placed && order.paymentMethod === 'cod') {
    title = t('ord.thanks', { name })
    body = t('ord.placedCod', { number: order.orderNumber, email: order.email })
  } else if (sp.payment === 'cancelled' && order.status === 'PAYMENT_PENDING') {
    tone = 'warn'
    body = t('ord.paymentCancelled')
  } else if (sp.payment === 'failed' && order.status === 'PAYMENT_PENDING') {
    tone = 'warn'
    body = t('ord.paymentFailed')
  } else if (order.status === 'PAYMENT_PENDING') {
    tone = 'warn'
    body = t('ord.awaitingPayment')
  }
  if (!body) return null

  return (
    <div
      role="status"
      className={`mb-8 border px-5 py-4 ${tone === 'ok' ? 'border-accent bg-accent/10' : 'border-line-strong bg-paper-2'}`}
    >
      {title && <p className="text-lg font-semibold text-heading">{title}</p>}
      <p className={`text-sm ${title ? 'mt-1' : ''} text-ink`}>{body}</p>
    </div>
  )
}
