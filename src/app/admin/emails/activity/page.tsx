/* ============================================================================
 * Marketing & Emails → Email activity: every email the shop has sent, is
 * about to send, or decided not to send — and why.
 *
 * Automated emails come from the job queue, which is also the automation
 * log: when it was triggered, when it is due, and the reason (e.g. "2 items
 * in the bag, last changed 14:00" → "Skipped: they bought it at 15:10").
 * Everything else (codes, transcripts, mailings) comes from the send log.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { emailActivity } from '@/lib/automations'
import { TEMPLATES } from '@/lib/email-templates'
import { Empty, Pagination, Pill, withParams } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Email activity' }

type SP = Record<string, string | string[] | undefined>
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

const NAMES: Record<string, string> = {
  ...Object.fromEntries(TEMPLATES.map((t) => [t.key, t.name])),
  newsletter_new_arrivals: 'Mailing: new arrivals',
  newsletter_promotion: 'Mailing: promotion',
  newsletter_test_new_arrivals: 'Test mailing: new arrivals',
  newsletter_test_promotion: 'Test mailing: promotion',
}
const name = (kind: string) => NAMES[kind] ?? kind.replace(/_/g, ' ')

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'sent', label: 'Sent' },
  { value: 'logged', label: 'Logged (no email service)' },
  { value: 'skipped', label: 'Not sent' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed', label: 'Failed' },
]

function tone(status: string) {
  if (status === 'sent') return <Pill tone="ok">Sent</Pill>
  if (status === 'scheduled') return <Pill tone="warn">Scheduled</Pill>
  if (status === 'failed') return <Pill tone="bad">Failed</Pill>
  if (status === 'logged') return <Pill tone="off">Logged</Pill>
  if (status === 'skipped') return <Pill tone="off">Not sent</Pill>
  return <Pill tone="off">{status.charAt(0).toUpperCase() + status.slice(1)}</Pill>
}

const at = (d: Date | string | null) =>
  d
    ? new Date(d).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Nicosia' })
    : '—'

export default async function ActivityPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/emails/activity')
  const sp = await searchParams
  const status = one(sp.status) ?? ''
  const kind = one(sp.kind) ?? ''
  const q = one(sp.q) ?? ''
  const list = await emailActivity({ status: status || undefined, kind: kind || undefined, q, page: Number(one(sp.page)) || 1 })

  return (
    <>
      <form className="mb-4 flex flex-wrap items-end gap-2">
        {status && <input type="hidden" name="status" value={status} />}
        <label>
          <span className="sr-only">Email</span>
          <select name="kind" defaultValue={kind} className="border border-line bg-paper px-3 py-2.5 text-sm">
            <option value="">Every email</option>
            {TEMPLATES.map((t) => (
              <option key={t.key} value={t.key}>
                {t.name}
              </option>
            ))}
            <option value="newsletter_new_arrivals">Mailing: new arrivals</option>
            <option value="newsletter_promotion">Mailing: promotion</option>
          </select>
        </label>
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Recipient, name or subject"
          aria-label="Search email activity"
          className="w-64 border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-accent"
        />
        <button className="btn btn-primary btn-sm">Filter</button>
      </form>

      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link
            key={s.value}
            role="tab"
            aria-selected={status === s.value}
            href={withParams('/admin/emails/activity', sp, { status: s.value || null, page: null })}
            className={`border px-3.5 py-2 text-sm ${status === s.value ? 'border-ink bg-accent text-paper' : 'border-line bg-paper hover:border-ink'}`}
          >
            {s.label}
          </Link>
        ))}
      </div>

      {list.rows.length === 0 ? (
        <Empty>{status || kind || q ? 'Nothing matches.' : 'No emails yet.'}</Empty>
      ) : (
        <div className="overflow-x-auto border border-line bg-paper">
          <table className="w-full min-w-[60rem] text-sm">
            <thead>
              <tr className="border-b border-line text-left">
                {['Email', 'Recipient', 'Subject', 'Triggered', 'Scheduled', 'Sent', 'Status', 'Why'].map((h) => (
                  <th key={h} className="label px-4 py-3 text-muted">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--color-line)] align-top">
              {list.rows.map((r) => (
                <tr key={`${r.source}-${r.id}`}>
                  <td className="px-4 py-3 font-medium">{name(r.kind)}</td>
                  <td className="px-4 py-3">
                    {r.recipient}
                    {r.name && <span className="block text-xs text-muted">{r.name}</span>}
                  </td>
                  <td className="max-w-[16rem] px-4 py-3 text-muted">{r.subject ?? '—'}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{at(r.triggeredAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{at(r.scheduledAt)}</td>
                  <td className="whitespace-nowrap px-4 py-3 text-muted">{at(r.sentAt)}</td>
                  <td className="px-4 py-3">{tone(r.status)}</td>
                  <td className="max-w-[20rem] px-4 py-3 text-xs text-muted">{r.detail || '—'}</td>
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
        noun={['email', 'emails']}
        href={(p) => withParams('/admin/emails/activity', sp, { page: p })}
      />
    </>
  )
}
