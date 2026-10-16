/* ============================================================================
 * The overview — three questions, in the order a shop owner asks them:
 *
 *   TODAY      what happened: orders, takings, new customers, open chats
 *   INVENTORY  what is running out, and what is sitting in carts
 *   ATTENTION  what needs a person: customers waiting, sizes to restock,
 *              emails that did not go out
 *
 * "Held" is units in live customer bags. Not a problem — the reservation
 * system doing its job — but it explains why available is lower than the
 * shelf count, which otherwise makes people distrust the numbers.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin, getOverview, getToday } from '@/lib/admin'
import { listStockRows } from '@/lib/admin-catalog'
import { inboxCounts, listInbox } from '@/lib/support'
import { customerActivity } from '@/lib/automations'
import { getSettings } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { PageHead, Stat, StockCount, Swatch, Thumb } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

function Group({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-10 first:mt-0">
      <div className="mb-3 flex items-baseline justify-between gap-4">
        <h2 className="label text-muted">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

const ago = (d: Date | string) => {
  const s = Math.max(0, Math.round((Date.now() - new Date(d).getTime()) / 1000))
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export default async function AdminOverviewPage() {
  const user = await guardAdmin()
  const settings = await getSettings(['low_stock_threshold', 'reservation_ttl_seconds'])
  const low = settings.low_stock_threshold
  const [overview, today, support, open, attention, activity] = await Promise.all([
    getOverview(low),
    getToday(),
    inboxCounts(),
    listInbox({ status: 'OPEN' }),
    listStockRows({ view: 'attention', sort: 'attention' }, low),
    customerActivity(),
  ])

  return (
    <>
      <PageHead title={`Good to see you, ${user.firstName}`} sub="Today, stock, and what needs you, in that order." />

      <Group title="Today">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Orders" value={today.orders} href="/admin/orders" />
          <Stat label="Revenue" value={formatMoney(today.revenueCents, 'en')} />
          <Stat label="New customers" value={today.newCustomers} />
          <Stat
            label="Open conversations"
            value={support.open}
            tone={support.unread > 0 ? 'warn' : 'plain'}
            href="/admin/support"
          />
        </div>
      </Group>

      <Group
        title="Customer activity"
        action={
          <Link href="/admin/emails/activity" className="text-xs text-muted underline hover:text-ink">
            Email activity
          </Link>
        }
      >
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="New customers today" value={activity.newCustomers} />
          <Stat
            label="Open conversations"
            value={activity.openConversations}
            tone={support.unread > 0 ? 'warn' : 'plain'}
            href="/admin/support"
          />
          <Stat label="Newsletter subscribers" value={activity.subscribers} href="/admin/emails/subscribers" />
          <Stat label="Abandoned bags" value={activity.abandonedBags} href="/admin/emails/activity?kind=abandoned_bag" />
          <Stat label="Emails scheduled" value={activity.scheduled} href="/admin/emails/activity?status=scheduled" />
          <Stat label="Emails sent today" value={activity.sentToday} href="/admin/emails/activity?status=sent" />
        </div>
      </Group>

      <Group title="Inventory">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="Sizes sold out"
            value={overview.stock.outOfStock}
            tone={overview.stock.outOfStock > 0 ? 'bad' : 'plain'}
            href="/admin/stock?view=sold_out"
          />
          <Stat
            label={`Sizes low (≤ ${low})`}
            value={overview.stock.low}
            tone={overview.stock.low > 0 ? 'warn' : 'plain'}
            href="/admin/stock?view=low"
          />
          <Stat label="Held in bags now" value={overview.stock.held} href="/admin/stock?view=all" />
          <Stat
            label="Products live"
            value={`${overview.products.active} / ${overview.products.total}`}
            href="/admin/products"
          />
        </div>
      </Group>

      <Group title="Needs attention">
        <div className="grid gap-6 xl:grid-cols-2">
          <div className="border border-line bg-paper">
            <div className="flex items-baseline justify-between border-b border-line px-5 py-3.5">
              <h3 className="font-semibold">Customers waiting</h3>
              <Link href="/admin/support" className="label text-muted hover:text-ink">
                Open inbox
              </Link>
            </div>
            {open.rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">No open conversations.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {open.rows.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link href={`/admin/support?c=${c.id}`} className="flex items-center gap-4 px-5 py-3 hover:bg-paper-2">
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm ${c.unread ? 'font-semibold' : ''}`}>{c.name || c.email || 'Guest'}</span>
                        <span className="block truncate text-xs text-muted">{c.lastMessage}</span>
                      </span>
                      <span className="shrink-0 text-right text-xs text-muted">
                        {ago(c.lastActivityAt)}
                        {c.unread > 0 && <span className="ml-2 rounded-full bg-sale px-1.5 text-[11px] text-white">{c.unread}</span>}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border border-line bg-paper">
            <div className="flex items-baseline justify-between border-b border-line px-5 py-3.5">
              <h3 className="font-semibold">Restock</h3>
              <Link href="/admin/stock?view=attention" className="label text-muted hover:text-ink">
                All {attention.total}
              </Link>
            </div>
            {attention.rows.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted">Every size on sale has more than {low} available.</p>
            ) : (
              <ul className="divide-y divide-[var(--color-line)]">
                {attention.rows.slice(0, 6).map((r) => (
                  <li key={r.variantId}>
                    <Link href={`/admin/stock?product=${r.productId}&view=all`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-paper-2">
                      <Thumb src={r.image} alt="" size="sm" />
                      <span className="min-w-0 flex-1 text-sm">
                        <span className="block truncate">{r.productName}</span>
                        <span className="text-xs text-muted">
                          <Swatch name={r.colourName} hex={r.colourHex} /> · {r.size}
                        </span>
                      </span>
                      <span className="text-sm">
                        <StockCount available={r.available} low={low} />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-6">
          {today.failedEmails7d.length === 0 ? (
            <p className="text-xs text-muted">✓ Every email in the last 7 days went out.</p>
          ) : (
            <div className="border border-sale/40 bg-paper">
              <h3 className="border-b border-line px-5 py-3.5 font-semibold text-sale">
                {today.failedEmails7d.length} email{today.failedEmails7d.length === 1 ? '' : 's'} did not go out (last 7 days)
              </h3>
              <ul className="divide-y divide-[var(--color-line)] text-sm">
                {today.failedEmails7d.map((e, i) => (
                  <li key={i} className="flex flex-wrap justify-between gap-x-4 px-5 py-2.5">
                    <span className="min-w-0 truncate">
                      {e.subject} <span className="text-muted">→ {e.toEmail}</span>
                    </span>
                    <span className="text-xs text-muted">{ago(e.createdAt)}</span>
                  </li>
                ))}
              </ul>
              <p className="px-5 py-3 text-xs text-muted">Usually the email service key or sending domain. Check the email settings (GMAIL_USER and GMAIL_APP_PASSWORD, or EMAIL_API_KEY) and EMAIL_FROM.</p>
            </div>
          )}
        </div>
      </Group>

      <p className="mt-8 max-w-2xl text-xs leading-relaxed text-muted">
        Stock held in a bag is returned to the shelf automatically after {Math.round(settings.reservation_ttl_seconds / 60)} minutes if
        the customer does not check out. You cannot set a size below the number currently held, those units are already
        promised.
      </p>
    </>
  )
}
