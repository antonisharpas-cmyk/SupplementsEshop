/* One member: details, addresses, orders and payments. */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guardAdmin } from '@/lib/admin'
import { getCustomer } from '@/lib/orders'
import { formatMoney } from '@/lib/pricing'
import { UUID } from '@/lib/api'
import { PageHead, Pill, Table } from '@/components/admin/ui'
import { CustomerControls } from '@/components/admin/CustomerControls'
import { OrderStatusPill, PaymentPill } from '@/components/admin/OrderStatus'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Customer' }

const day = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Europe/Nicosia' }).format(d) : '—')

export default async function AdminCustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await guardAdmin(`/admin/customers/${id}`)
  if (!UUID.test(id)) notFound()
  const c = await getCustomer(id)
  if (!c) notFound()
  const spent = c.orders
    .filter((o) => ['PAID', 'PROCESSING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED'].includes(o.status))
    .reduce((s, o) => s + o.totalCents, 0)

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex gap-2 text-xs text-muted">
        <Link href="/admin/customers" className="hover:underline">Customers</Link>
        <span aria-hidden>/</span>
        <span className="text-ink">{c.firstName} {c.lastName}</span>
      </nav>
      <PageHead
        title={`${c.firstName} ${c.lastName}`}
        sub={
          <span className="inline-flex flex-wrap items-center gap-3">
            <span>{c.email}</span>
            <span>{c.phone}</span>
            {c.isActive ? <Pill tone="ok">Active</Pill> : <Pill tone="off">Switched off</Pill>}
            {c.role !== 'CUSTOMER' && <Pill tone="warn">{c.role.replace('_', ' ')}</Pill>}
          </span>
        }
      />

      <div className="mb-8 grid gap-3 sm:grid-cols-4">
        {[
          ['Member since', day(c.createdAt)],
          ['Last sign in', day(c.lastLoginAt)],
          ['Orders', String(c.orders.length)],
          ['Spent', formatMoney(spent)],
        ].map(([k, v]) => (
          <div key={k} className="border border-line bg-paper p-4">
            <p className="label text-muted">{k}</p>
            <p className="mt-1.5 text-lg font-semibold text-heading">{v}</p>
          </div>
        ))}
      </div>

      <section className="mb-8 border border-line bg-paper p-5">
        <h2 className="label mb-3 text-muted">Account</h2>
        <p className="mb-4 text-sm text-muted">Email language: {c.locale.toUpperCase()} · Email verified {day(c.emailVerifiedAt)}</p>
        <CustomerControls id={c.id} isActive={c.isActive} email={c.email} />
      </section>

      <h2 className="mb-3 text-lg font-semibold">Orders</h2>
      {c.orders.length === 0 ? (
        <p className="mb-8 text-sm text-muted">No orders yet.</p>
      ) : (
        <div className="mb-8">
          <Table head={['Order', 'Placed', 'Items', 'Payment', 'Status', 'Total']}>
            {c.orders.map((o) => (
              <tr key={o.id}>
                <td className="px-4 py-3"><Link href={`/admin/orders/${o.id}`} className="font-mono text-heading hover:underline">{o.orderNumber}</Link></td>
                <td className="px-4 py-3 text-muted">{day(o.createdAt)}</td>
                <td className="px-4 py-3">{o.itemCount}</td>
                <td className="px-4 py-3"><PaymentPill method={o.paymentMethod} status={o.paymentStatus} /></td>
                <td className="px-4 py-3"><OrderStatusPill status={o.status} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(o.totalCents)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Payments</h2>
      {c.payments.length === 0 ? (
        <p className="mb-8 text-sm text-muted">No payments yet.</p>
      ) : (
        <div className="mb-8">
          <Table head={['Date', 'Order', 'Method', 'Status', 'Amount']}>
            {c.payments.map((p) => (
              <tr key={p.id}>
                <td className="px-4 py-3 text-muted">{day(p.paidAt ?? p.createdAt)}</td>
                <td className="px-4 py-3 font-mono">{p.orderNumber}</td>
                <td className="px-4 py-3">{p.provider === 'stripe' ? `Card${p.cardLast4 ? ` •••• ${p.cardLast4}` : ''}` : 'Cash'}</td>
                <td className="px-4 py-3">{p.status.toLowerCase().replace(/_/g, ' ')}</td>
                <td className="px-4 py-3 text-right tabular-nums">{formatMoney(p.amountCents)}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}

      <h2 className="mb-3 text-lg font-semibold">Addresses</h2>
      {c.addresses.length === 0 ? (
        <p className="text-sm text-muted">No saved addresses.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {c.addresses.map((a) => (
            <li key={a.id} className="border border-line bg-paper p-4 text-sm">
              <p className="text-heading">{a.label || a.recipientName} {a.isDefault && <span className="ml-1 text-xs text-accent">default</span>}</p>
              <p className="text-ink-soft">{[a.recipientName, a.line1, a.line2, `${a.postalCode} ${a.city}`, a.phone].filter(Boolean).join(', ')}</p>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
