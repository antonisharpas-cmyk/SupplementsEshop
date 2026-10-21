/* ============================================================================
 * Orders: everything customers have bought, newest first.
 *
 * Opens on "To do": new cash orders to confirm, paid card orders to prepare,
 * and orders being prepared or waiting for collection.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { listAdminOrders, orderCounts } from '@/lib/orders'
import { formatMoney } from '@/lib/pricing'
import { Empty, PageHead, Pagination, Table, btn, input, withParams } from '@/components/admin/ui'
import { OrderStatusPill, PaymentPill } from '@/components/admin/OrderStatus'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Orders' }

type SP = Record<string, string | string[] | undefined>

const VIEWS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'open', label: 'To do', statuses: ['PENDING', 'PAID', 'PROCESSING', 'READY_FOR_PICKUP'] },
  { key: 'PAYMENT_PENDING', label: 'Awaiting payment', statuses: ['PAYMENT_PENDING'] },
  { key: 'SHIPPED', label: 'Out for delivery', statuses: ['SHIPPED'] },
  { key: 'DELIVERED', label: 'Delivered', statuses: ['DELIVERED'] },
  { key: 'CANCELLED', label: 'Cancelled', statuses: ['CANCELLED', 'REFUNDED'] },
  { key: 'all', label: 'All', statuses: [] },
]

const when = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Nicosia' }).format(d)

export default async function AdminOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/orders')
  const sp = await searchParams
  const view = typeof sp.view === 'string' ? sp.view : 'open'
  const q = typeof sp.q === 'string' ? sp.q : ''
  const page = Number(sp.page) || 1
  const [list, counts] = await Promise.all([
    listAdminOrders({ status: view === 'all' ? undefined : view, q, page }),
    orderCounts(),
  ])
  const count = (v: (typeof VIEWS)[number]) =>
    v.statuses.length ? v.statuses.reduce((n, s) => n + (counts[s] ?? 0), 0) : Object.values(counts).reduce((a, b) => a + b, 0)

  return (
    <>
      <PageHead
        title="Orders"
        sub={`${list.total} order${list.total === 1 ? '' : 's'} in this view · click one to manage it`}
        action={
          <Link href="/admin/orders/new" className={btn.primary}>
            + New order
          </Link>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={withParams('/admin/orders', {}, { view: v.key === 'open' ? null : v.key, q: q || null })}
            className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm transition-colors ${
              view === v.key ? 'border-transparent bg-gold text-black' : 'border-line bg-paper hover:border-ink'
            }`}
          >
            {v.label}
            <span className={`rounded-full px-1.5 text-xs ${view === v.key ? 'bg-black/15' : 'bg-paper-2 text-muted'}`}>{count(v)}</span>
          </Link>
        ))}
      </div>

      <form className="mb-5 flex gap-2" action="/admin/orders">
        {view !== 'open' && <input type="hidden" name="view" value={view} />}
        <input name="q" defaultValue={q} placeholder="Search order number, name, email or phone" className={`${input} max-w-xl`} />
      </form>

      {list.rows.length === 0 ? (
        <Empty>No orders here{q ? ` matching “${q}”` : ''}.</Empty>
      ) : (
        <Table head={['Order', 'Placed', 'Customer', 'Items', 'Delivery', 'Payment', 'Status', 'Total']}>
          {list.rows.map((o) => (
            <tr key={o.id} className="hover:bg-paper-2">
              <td className="px-4 py-3">
                <Link href={`/admin/orders/${o.id}`} className="font-mono text-heading underline-offset-4 hover:underline">
                  {o.orderNumber}
                </Link>
                {o.channel === 'phone' && (
                  <span className="ml-2 rounded-full bg-accent/15 px-2 py-0.5 text-[10px] font-semibold tracking-wider text-accent uppercase">Phone</span>
                )}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-muted">{when(o.createdAt)}</td>
              <td className="px-4 py-3">
                {o.customerName}
                <span className="block text-xs text-muted">{o.email}</span>
              </td>
              <td className="px-4 py-3 tabular-nums">{o.itemCount}</td>
              <td className="px-4 py-3">{o.deliveryKind === 'PICKUP' ? 'Collect' : 'Home'}</td>
              <td className="px-4 py-3">
                <PaymentPill method={o.paymentMethod} status={o.paymentStatus} />
              </td>
              <td className="px-4 py-3">
                <OrderStatusPill status={o.status} />
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-heading">{formatMoney(o.totalCents)}</td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination page={list.page} pages={list.pages} total={list.total} noun={['order', 'orders']} href={(p) => withParams('/admin/orders', sp, { page: p })} />
    </>
  )
}
