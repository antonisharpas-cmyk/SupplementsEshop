/* ============================================================================
 * Marketing & Emails → SMS campaigns, sent through sms.to.
 *
 * Write the offer, pick who gets it (everyone, or one language), check the
 * price and send a test to your own phone, then send. Only customers who said
 * yes to offers by SMS are ever included.
 * ========================================================================== */

import { guardAdmin } from '@/lib/admin'
import { audienceCounts, listSmsCampaigns, listSmsSubscribers, optOutLine } from '@/lib/sms-marketing'
import { SMS_SENDER_ID, smsBalance, smsEnabled } from '@/lib/sms'
import { Empty, Pill, Stat, Table } from '@/components/admin/ui'
import { SmsComposer } from '@/components/admin/SmsComposer'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'SMS campaigns' }

const when = (d: Date | null) =>
  d ? new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Nicosia' }).format(d) : ''

const AUDIENCE: Record<string, string> = { all: 'Everyone', en: 'English', el: 'Greek', ru: 'Russian' }
const SOURCE: Record<string, string> = { registration: 'Sign up', checkout: 'Checkout', account: 'Account', admin: 'Admin' }

export default async function SmsCampaignsPage() {
  await guardAdmin('/admin/emails/sms')
  const [counts, campaigns, subs, balance] = await Promise.all([
    audienceCounts(),
    listSmsCampaigns(),
    listSmsSubscribers(50),
    smsBalance(),
  ])

  return (
    <div className="space-y-10">
      {!smsEnabled && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          sms.to is not connected yet (SMSTO_API_KEY), so SMS are written to the server log instead of being sent. You can
          still try everything here.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Said yes to SMS" value={subs.subscribed} />
        <Stat label="Stopped SMS" value={subs.unsubscribed} />
        <Stat label="Sender name" value={<span className="font-mono text-xl">{SMS_SENDER_ID}</span>} />
        <Stat
          label="sms.to balance"
          value={balance ? `${balance.balance.toFixed(2)} ${balance.currency}` : <span className="text-base text-muted">{smsEnabled ? 'Unavailable' : 'Not connected'}</span>}
        />
      </div>

      <SmsComposer counts={counts} optOut={optOutLine()} enabled={smsEnabled} senderId={SMS_SENDER_ID} />

      <section>
        <h2 className="mb-3 text-lg font-semibold">Sent campaigns</h2>
        {campaigns.length === 0 ? (
          <Empty>No SMS campaigns yet.</Empty>
        ) : (
          <Table head={['Sent', 'Message', 'Audience', 'SMS each', 'Recipients', 'Delivered to sms.to', 'Status']}>
            {campaigns.map((c) => (
              <tr key={c.id} className="align-top hover:bg-paper-2">
                <td className="px-4 py-3 whitespace-nowrap text-muted">{when(c.createdAt)}</td>
                <td className="max-w-md px-4 py-3">
                  <p className="line-clamp-3 whitespace-pre-line text-ink">{c.message}</p>
                  {c.error && <p className="mt-1 text-xs text-sale">{c.error.split('\n')[0]}</p>}
                </td>
                <td className="px-4 py-3 text-muted">{AUDIENCE[c.audience] ?? c.audience}</td>
                <td className="px-4 py-3 tabular-nums">{c.segments}</td>
                <td className="px-4 py-3 tabular-nums">{c.recipientCount}</td>
                <td className="px-4 py-3 tabular-nums">
                  {c.sentCount}
                  {c.failedCount > 0 && <span className="text-sale"> · {c.failedCount} failed</span>}
                </td>
                <td className="px-4 py-3">
                  {c.status === 'SENT' ? (
                    <Pill tone="ok">Sent</Pill>
                  ) : c.status === 'LOGGED' ? (
                    <Pill tone="off">Logged only</Pill>
                  ) : c.status === 'PARTIAL' ? (
                    <Pill tone="warn">Partly sent</Pill>
                  ) : c.status === 'FAILED' ? (
                    <Pill tone="bad">Failed</Pill>
                  ) : (
                    <Pill tone="warn">Sending</Pill>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </section>

      <section>
        <h2 className="mb-1 text-lg font-semibold">SMS subscribers</h2>
        <p className="mb-3 text-sm text-muted">
          Customers say yes when they sign up, at checkout or in their account. Anyone can stop at {optOutLine().replace('STOP: ', '')}.
        </p>
        {subs.rows.length === 0 ? (
          <Empty>Nobody has said yes to SMS offers yet.</Empty>
        ) : (
          <Table head={['Phone', 'Name', 'Language', 'From', 'Status', 'Since']}>
            {subs.rows.map((s) => (
              <tr key={s.id} className="hover:bg-paper-2">
                <td className="px-4 py-3 font-mono text-heading">{s.phone}</td>
                <td className="px-4 py-3">{s.firstName ?? ''}</td>
                <td className="px-4 py-3 text-muted">{AUDIENCE[s.locale] ?? s.locale}</td>
                <td className="px-4 py-3 text-muted">{SOURCE[s.source] ?? s.source}</td>
                <td className="px-4 py-3">{s.status === 'SUBSCRIBED' ? <Pill tone="ok">Yes to SMS</Pill> : <Pill tone="off">Stopped</Pill>}</td>
                <td className="px-4 py-3 whitespace-nowrap text-muted">{when(s.status === 'SUBSCRIBED' ? s.consentAt : s.unsubscribedAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </section>
    </div>
  )
}
