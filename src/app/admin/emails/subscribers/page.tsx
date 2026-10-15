/* ============================================================================
 * Marketing & Emails → Subscribers: who may receive marketing email.
 *
 * Only CONFIRMED subscribers (double opt-in, with the consent time recorded)
 * ever receive a mailing or an abandoned-bag reminder. Pending people have
 * not clicked the link yet; unsubscribed people are kept, with the date, so
 * the shop can show it stopped — and are never mailed again unless they sign
 * up afresh. Unsubscribing needs no login: every marketing email carries a
 * one-click link.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { listSubscribers, newsletterStats } from '@/lib/newsletter'
import { Empty, Pagination, Pill, Stat, withParams } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Subscribers' }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const when = (d: Date | null) =>
  d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const STATUS_TABS = [
  { value: '', label: 'Everyone' },
  { value: 'SUBSCRIBED', label: 'Confirmed' },
  { value: 'PENDING', label: 'Waiting to confirm' },
  { value: 'UNSUBSCRIBED', label: 'Unsubscribed' },
]

export default async function SubscribersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/emails/subscribers')
  const sp = await searchParams
  const status = one(sp.status) ?? ''
  const q = one(sp.q) ?? ''
  const [stats, list] = await Promise.all([newsletterStats(), listSubscribers({ status, q, page: Number(one(sp.page)) || 1 })])

  return (
    <>
      <div className="mb-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Confirmed subscribers" value={stats.subscribed} />
        <Stat label="New in the last 30 days" value={stats.newLast30Days} />
        <Stat label="Waiting to confirm" value={stats.pending} />
        <Stat label="Unsubscribed" value={stats.unsubscribed} />
      </div>

      <section>
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold tracking-tight">Subscribers</h2>
          <form className="flex gap-2">
            {status && <input type="hidden" name="status" value={status} />}
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Search email or name"
              aria-label="Search subscribers"
              className="w-64 border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
            />
            <button className="btn btn-primary btn-sm">Search</button>
          </form>
        </div>

        <div role="tablist" className="mb-4 flex flex-wrap gap-2">
          {STATUS_TABS.map((tab) => (
            <Link
              key={tab.value}
              role="tab"
              aria-selected={status === tab.value}
              href={withParams('/admin/emails/subscribers', sp, { status: tab.value || null, page: null })}
              className={`border px-3.5 py-2 text-sm ${status === tab.value ? 'border-ink bg-accent text-paper' : 'border-line bg-paper hover:border-ink'}`}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {list.rows.length === 0 ? (
          <Empty>{q || status ? 'Nobody matches.' : 'No sign-ups yet. The form is on the homepage and at /newsletter.'}</Empty>
        ) : (
          <div className="overflow-x-auto border border-line bg-paper">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-line text-left">
                  {['Email', 'Name', 'Status', 'Language', 'Joined from', 'Consent given', 'Confirmed / left'].map((h) => (
                    <th key={h} className="label px-4 py-3 text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--color-line)]">
                {list.rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">{r.email}</td>
                    <td className="px-4 py-3 text-muted">{r.firstName ?? '—'}</td>
                    <td className="px-4 py-3">
                      {r.status === 'SUBSCRIBED' ? (
                        <Pill tone="ok">Confirmed</Pill>
                      ) : r.status === 'PENDING' ? (
                        <Pill tone="warn">Waiting</Pill>
                      ) : (
                        <Pill tone="off">Unsubscribed</Pill>
                      )}
                    </td>
                    <td className="px-4 py-3 uppercase text-muted">{r.locale}</td>
                    <td className="px-4 py-3 text-muted">{r.source.replace('_', ' ')}</td>
                    <td className="px-4 py-3 text-muted">{when(r.consentAt)}</td>
                    <td className="px-4 py-3 text-muted">
                      {r.status === 'UNSUBSCRIBED' ? `Left ${when(r.unsubscribedAt)}` : when(r.confirmedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination
          page={list.page}
          pages={list.pages}
          total={list.total}
          noun={['subscriber', 'subscribers']}
          href={(p) => withParams('/admin/emails/subscribers', sp, { page: p })}
        />
      </section>
    </>
  )
}
