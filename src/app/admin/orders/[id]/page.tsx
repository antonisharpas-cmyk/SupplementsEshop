/* One order, for staff: what was bought, by whom, where it goes, how it was
   paid, and the buttons that move it along. */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guardAdmin } from '@/lib/admin'
import { getOrderById, nextSteps } from '@/lib/orders'
import { invoicesForOrder } from '@/lib/invoices'
import { formatMoney } from '@/lib/pricing'
import { tField } from '@/i18n/field'
import { UUID } from '@/lib/api'
import { PageHead, Thumb } from '@/components/admin/ui'
import { OrderControls } from '@/components/admin/OrderControls'
import { OrderStatusPill, PaymentPill } from '@/components/admin/OrderStatus'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Order' }

const when = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Nicosia' }).format(d) : '—'

function Box({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <h2 className="label mb-3 text-muted">{title}</h2>
      <div className="text-sm">{children}</div>
    </section>
  )
}

export default async function AdminOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await guardAdmin(`/admin/orders/${id}`)
  if (!UUID.test(id)) notFound()
  const order = await getOrderById(id)
  if (!order) notFound()
  const docs = await invoicesForOrder(order.id)

  const address = order.shippingAddress as Record<string, string> | null
  const latest = order.payments[0]
  const cashPending = order.paymentMethod === 'cod' && order.payments.some((p) => p.status === 'PENDING')
  const paid = order.payments.some((p) => p.status === 'SUCCEEDED')

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex gap-2 text-xs text-muted">
        <Link href="/admin/orders" className="hover:underline">
          Orders
        </Link>
        <span aria-hidden>/</span>
        <span className="text-ink">{order.orderNumber}</span>
      </nav>
      <PageHead
        title={`Order ${order.orderNumber}`}
        sub={
          <span className="inline-flex flex-wrap items-center gap-3">
            <OrderStatusPill status={order.status} />
            <PaymentPill method={order.paymentMethod} status={latest?.status ?? null} />
            <span>Placed {when(order.createdAt)}</span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          <Box title="Next step">
            <OrderControls
              orderId={order.id}
              status={order.status}
              next={nextSteps(order.status, order.deliveryKind)}
              paymentMethod={order.paymentMethod}
              cashPending={cashPending}
              paid={paid}
              note={order.adminNote ?? ''}
              deliveryKind={order.deliveryKind}
            />
          </Box>

          <Box title={`Items (${order.items.reduce((n, i) => n + i.quantity, 0)})`}>
            <ul className="divide-y divide-[var(--color-line)]">
              {order.items.map((i) => (
                <li key={i.id} className="flex items-center gap-4 py-3">
                  <Thumb src={i.imageUrl} alt="" size="sm" />
                  <div className="min-w-0 flex-1">
                    {i.productId ? (
                      <Link href={`/admin/products/${i.productId}`} className="text-heading hover:underline">
                        {i.productName}
                      </Link>
                    ) : (
                      <span className="text-heading">{i.productName}</span>
                    )}
                    <span className="block text-xs text-muted">
                      {[i.colorName, i.size].filter(Boolean).join(' · ')} · <span className="font-mono">{i.sku}</span>
                    </span>
                  </div>
                  <span className="tabular-nums text-muted">× {i.quantity}</span>
                  <span className="w-24 text-right tabular-nums">{formatMoney(i.lineTotalCents)}</span>
                </li>
              ))}
            </ul>
            <dl className="mt-4 ml-auto max-w-xs space-y-1.5">
              <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{formatMoney(order.subtotalCents)}</dd></div>
              {order.promotionDiscountCents > 0 && <div className="flex justify-between text-sale"><dt>Promotions</dt><dd>−{formatMoney(order.promotionDiscountCents)}</dd></div>}
              {order.promoCodeDiscountCents > 0 && (
                <div className="flex justify-between text-sale">
                  <dt>Code {String((order.promoCodeSnapshot as { code?: string } | null)?.code ?? '')}</dt>
                  <dd>−{formatMoney(order.promoCodeDiscountCents)}</dd>
                </div>
              )}
              <div className="flex justify-between"><dt className="text-muted">Delivery</dt><dd>{order.deliveryCents ? formatMoney(order.deliveryCents) : 'Free'}</dd></div>
              <div className="flex justify-between border-t border-line pt-2 font-semibold text-heading"><dt>Total</dt><dd>{formatMoney(order.totalCents)}</dd></div>
              <div className="flex justify-between text-xs text-muted"><dt>VAT included</dt><dd>{formatMoney(order.vatCents)}</dd></div>
            </dl>
          </Box>

          {order.adminNote && (
            <Box title="Notes">
              <p className="whitespace-pre-wrap text-ink-soft">{order.adminNote}</p>
            </Box>
          )}
        </div>

        <div className="space-y-6">
          <Box title="Customer">
            <p className="text-heading">{order.customerName}</p>
            <p><a href={`mailto:${order.email}`} className="underline">{order.email}</a></p>
            <p><a href={`tel:${order.phone}`} className="underline">{order.phone}</a></p>
            {order.userId ? (
              <Link href={`/admin/customers/${order.userId}`} className="mt-2 inline-block text-xs text-accent underline">
                Member profile
              </Link>
            ) : (
              <p className="mt-2 text-xs text-muted">Guest checkout</p>
            )}
            {order.customerNote && (
              <p className="mt-3 border-l-2 border-accent pl-3 text-ink-soft">“{order.customerNote}”</p>
            )}
          </Box>

          <Box title={order.deliveryKind === 'PICKUP' ? 'Collection' : 'Delivery'}>
            <p className="text-heading">{tField(order.deliveryOptionName, 'en')}</p>
            {address && (
              <p className="mt-1 text-ink-soft">
                {[address.recipientName, address.line1, address.line2, `${address.postalCode} ${address.city}`, address.country, address.phone]
                  .filter(Boolean)
                  .map((l) => <span key={l} className="block">{l}</span>)}
              </p>
            )}
            {order.trackingNumber && <p className="mt-2">Tracking: <span className="font-mono">{order.trackingNumber}</span></p>}
            <p className="mt-2 text-xs text-muted">Shipped {when(order.shippedAt)} · Delivered {when(order.deliveredAt)}</p>
          </Box>

          <Box title="Payment">
            {order.payments.length === 0 && <p className="text-muted">No payment recorded.</p>}
            <ul className="space-y-3">
              {order.payments.map((p) => (
                <li key={p.id}>
                  <p className="text-heading">
                    {p.provider === 'stripe' ? 'Card (Stripe)' : 'Cash on delivery'} · {formatMoney(p.amountCents)}
                  </p>
                  <p className="text-xs text-muted">
                    {p.status.toLowerCase().replace(/_/g, ' ')}
                    {p.cardBrand && p.cardLast4 ? ` · ${p.cardBrand.toUpperCase()} •••• ${p.cardLast4}` : ''}
                    {p.paidAt ? ` · ${when(p.paidAt)}` : ''}
                    {p.refundedCents ? ` · refunded ${formatMoney(p.refundedCents)}` : ''}
                  </p>
                  {p.providerPaymentId && (
                    <a
                      href={`https://dashboard.stripe.com/payments/${p.providerPaymentId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-accent underline"
                    >
                      Open in Stripe
                    </a>
                  )}
                </li>
              ))}
            </ul>
          </Box>
          <Box title="Invoices">
            {docs.length === 0 ? (
              <p className="text-muted">Issued automatically once the order is paid.</p>
            ) : (
              <ul className="space-y-2">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-baseline justify-between gap-3">
                    <Link href={`/admin/accounting/${d.id}`} className="font-mono text-heading underline-offset-4 hover:text-accent hover:underline">
                      {d.number}
                    </Link>
                    <span className={`tabular-nums ${d.kind === 'CREDIT_NOTE' ? 'text-sale' : 'text-muted'}`}>
                      {formatMoney(d.kind === 'CREDIT_NOTE' ? -d.totalCents : d.totalCents)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Box>
        </div>
      </div>
    </>
  )
}
