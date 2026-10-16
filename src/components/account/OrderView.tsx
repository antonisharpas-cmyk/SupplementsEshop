/* One order, as the customer sees it: where it is, what is in it, what it
   cost and how it was paid. Used by the account and by the private order
   link a guest gets. */

import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { getTranslator, type MessageKey } from '@/i18n/messages'
import { tField } from '@/i18n/field'
import { formatMoney } from '@/lib/pricing'
import type { OrderDetail } from '@/lib/orders'
import { OrderActions } from './OrderActions'

const STEPS_SHIP: string[] = ['PENDING', 'PROCESSING', 'SHIPPED', 'DELIVERED']
const STEPS_PICKUP: string[] = ['PENDING', 'PROCESSING', 'READY_FOR_PICKUP', 'DELIVERED']

export function StatusPill({ status, locale }: { status: string; locale: Locale }) {
  const t = getTranslator(locale)
  const tone =
    status === 'CANCELLED' || status === 'REFUNDED'
      ? 'bg-paper text-muted border border-line'
      : status === 'DELIVERED'
        ? 'bg-ok/15 text-ok'
        : status === 'PAYMENT_PENDING' || status === 'PENDING'
          ? 'bg-accent/15 text-accent'
          : 'bg-accent text-black'
  return <span className={`inline-block rounded-full px-2.5 py-1 label ${tone}`}>{t(`st.${status}` as MessageKey)}</span>
}

export function formatDate(d: Date | string, locale: Locale, withTime = false) {
  return new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit' } : {}),
    timeZone: 'Europe/Nicosia',
  }).format(new Date(d))
}

export function OrderView({
  order,
  locale,
  token,
  canReorder,
}: {
  order: NonNullable<OrderDetail>
  locale: Locale
  token?: string
  canReorder: boolean
}) {
  const t = getTranslator(locale)
  const base = `/${locale}`
  const money = (c: number) => formatMoney(c, locale, order.currency)
  const steps = order.deliveryKind === 'PICKUP' ? STEPS_PICKUP : STEPS_SHIP
  const stepIndex = (() => {
    const s = order.status === 'PAID' || order.status === 'PAYMENT_PENDING' ? 'PENDING' : order.status
    return steps.indexOf(s)
  })()
  const closed = order.status === 'CANCELLED' || order.status === 'REFUNDED'
  const payment = order.payments.find((p) => p.status === 'SUCCEEDED') ?? order.payments[0]
  const address = order.shippingAddress as Record<string, string> | null
  const method =
    order.paymentMethod === 'card' ? t('pm.card') : order.deliveryKind === 'PICKUP' ? t('pm.codPickup') : t('pm.cod')

  return (
    <div>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{t('ord.title', { number: order.orderNumber })}</h1>
        <StatusPill status={order.status} locale={locale} />
      </div>
      <p className="mt-1 text-sm text-muted">{t('ord.placedOn', { date: formatDate(order.createdAt, locale, true) })}</p>

      {!closed && stepIndex >= 0 && (
        <ol className="mt-6 grid grid-cols-4 gap-1" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s}>
              <span className={`block h-1.5 rounded-full ${i <= stepIndex ? 'bg-accent' : 'bg-line'}`} />
              <span className={`mt-2 block text-[11px] leading-tight ${i <= stepIndex ? 'text-heading' : 'text-muted'}`}>
                {t(`st.${s}` as MessageKey)}
              </span>
            </li>
          ))}
        </ol>
      )}

      {order.status === 'SHIPPED' && order.trackingNumber && (
        <p className="mt-5 border border-line bg-paper-2 px-4 py-3 text-sm">
          {t('ord.tracking')}: <span className="font-mono text-heading">{order.trackingNumber}</span>
          {order.trackingUrl && (
            <a href={order.trackingUrl} target="_blank" rel="noopener noreferrer" className="ml-3 text-accent underline">
              {t('ord.track')}
            </a>
          )}
        </p>
      )}

      <OrderActions
        locale={locale}
        orderNumber={order.orderNumber}
        token={token}
        canPay={order.status === 'PAYMENT_PENDING'}
        canCancel={order.status === 'PENDING' || order.status === 'PAYMENT_PENDING'}
        canReorder={canReorder && order.status !== 'PAYMENT_PENDING'}
      />

      <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="items">
          <h2 id="items" className="label mb-3 text-muted">
            {t('ord.items')}
          </h2>
          <ul className="divide-y divide-[var(--color-line)] border-y border-line">
            {order.items.map((i) => (
              <li key={i.id} className="flex gap-4 py-4">
                <span className="h-20 w-15 shrink-0 overflow-hidden bg-paper-2">
                  {i.imageUrl && (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={i.imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  {i.productSlug ? (
                    <Link href={`${base}/products/${i.productSlug}`} className="text-heading hover:underline">
                      {i.productName}
                    </Link>
                  ) : (
                    <span className="text-heading">{i.productName}</span>
                  )}
                  <span className="block text-xs text-muted">{[i.colorName, i.size].filter(Boolean).join(' · ')}</span>
                  <span className="block text-xs text-muted">{t('ord.qty', { n: i.quantity })}</span>
                </span>
                <span className="text-sm tabular-nums">{money(i.lineTotalCents)}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 ml-auto max-w-xs space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">{t('cart.subtotal')}</dt>
              <dd>{money(order.subtotalCents)}</dd>
            </div>
            {order.promotionDiscountCents > 0 && (
              <div className="flex justify-between text-sale">
                <dt>{t('cart.discount')}</dt>
                <dd>−{money(order.promotionDiscountCents)}</dd>
              </div>
            )}
            {order.promoCodeDiscountCents > 0 && (
              <div className="flex justify-between text-sale">
                <dt>{t('cart.promoDiscount')}</dt>
                <dd>−{money(order.promoCodeDiscountCents)}</dd>
              </div>
            )}
            <div className="flex justify-between">
              <dt className="text-muted">{t('cart.delivery')}</dt>
              <dd>{order.deliveryCents === 0 ? t('cart.free') : money(order.deliveryCents)}</dd>
            </div>
            <div className="flex justify-between border-t border-line pt-2 text-base font-semibold text-heading">
              <dt>{t('cart.total')}</dt>
              <dd>{money(order.totalCents)}</dd>
            </div>
            <div className="flex justify-between text-xs text-muted">
              <dt>{t('cart.vatIncluded', { amount: '' }).trim()}</dt>
              <dd>{money(order.vatCents)}</dd>
            </div>
          </dl>
        </section>

        <aside className="space-y-5 text-sm">
          <div className="border border-line bg-paper-2 p-5">
            <h2 className="label mb-2 text-muted">{order.deliveryKind === 'PICKUP' ? t('ord.pickup') : t('ord.deliveryTo')}</h2>
            <p className="text-heading">{tField(order.deliveryOptionName, locale)}</p>
            {address && (
              <p className="mt-1 text-ink-soft">
                {[address.recipientName, address.line1, address.line2, `${address.postalCode} ${address.city}`, address.phone]
                  .filter(Boolean)
                  .map((l) => (
                    <span key={l} className="block">
                      {l}
                    </span>
                  ))}
              </p>
            )}
            {order.estimatedDeliveryFrom && order.estimatedDeliveryTo && !closed && order.status !== 'DELIVERED' && (
              <p className="mt-2 text-xs text-muted">
                {t('ord.estimated', {
                  from: formatDate(order.estimatedDeliveryFrom, locale),
                  to: formatDate(order.estimatedDeliveryTo, locale),
                })}
              </p>
            )}
          </div>
          <div className="border border-line bg-paper-2 p-5">
            <h2 className="label mb-2 text-muted">{t('ord.payment')}</h2>
            <p className="text-heading">{method}</p>
            {payment && (
              <p className="mt-1 text-ink-soft">
                {t(`ps.${payment.status}` as MessageKey)}
                {payment.cardBrand && payment.cardLast4 && (
                  <span className="block text-xs text-muted">
                    {t('ord.cardEnding', { brand: payment.cardBrand.toUpperCase(), last4: payment.cardLast4 })}
                  </span>
                )}
              </p>
            )}
          </div>
          {order.customerNote && (
            <div className="border border-line bg-paper-2 p-5">
              <h2 className="label mb-2 text-muted">{t('ord.note')}</h2>
              <p className="whitespace-pre-wrap text-ink-soft">{order.customerNote}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
