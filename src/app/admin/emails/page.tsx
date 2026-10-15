/* ============================================================================
 * Marketing & Emails → Automated emails.
 *
 * Every email the shop sends by itself, what sets it off, and whether it is
 * on. Required ones (codes, security, orders, transcripts) cannot be switched
 * off — they are part of the shop working, not marketing.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { allTemplateStates, type TemplateState } from '@/lib/mailer'
import { delayLabel as hoursLabel, PLANNED_TRIGGERS, type EmailCategory } from '@/lib/email-templates'
import { Pill } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Automated emails' }

const TYPE: Record<EmailCategory, string> = { essential: 'Essential', lifecycle: 'Lifecycle', marketing: 'Marketing' }
const GROUPS: { title: string; sub: string; category: EmailCategory }[] = [
  { title: 'Essential', sub: 'Account, security, orders and customer service. Always on.', category: 'essential' },
  { title: 'Customer lifecycle', sub: 'Helpful moments in a customer’s journey. Optional.', category: 'lifecycle' },
  { title: 'Marketing', sub: 'Only to people who agreed to hear from you, with an unsubscribe link.', category: 'marketing' },
]

function trigger(s: TemplateState) {
  return s.delayMinutes !== null ? `${hoursLabel(s.delayMinutes)} after: ${s.def.trigger.toLowerCase()}` : s.def.trigger
}

export default async function AutomatedEmailsPage() {
  await guardAdmin('/admin/emails')
  const states = await allTemplateStates()

  return (
    <>
      {GROUPS.map((g) => {
        const rows = states.filter((s) => s.def.category === g.category)
        if (!rows.length) return null
        return (
          <section key={g.category} className="mb-10">
            <h2 className="text-lg font-semibold tracking-tight">{g.title}</h2>
            <p className="mb-3 text-sm text-muted">{g.sub}</p>
            <div className="overflow-x-auto border border-line bg-paper">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-line text-left">
                    {['Automation', 'Type', 'Trigger', 'Status', 'Action'].map((h) => (
                      <th key={h} className="label px-4 py-3 text-muted">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--color-line)]">
                  {rows.map((s) => (
                    <tr key={s.def.key}>
                      <td className="px-4 py-3">
                        <Link href={`/admin/emails/${s.def.key}`} className="font-medium hover:underline">
                          {s.def.name}
                        </Link>
                        {s.def.internal && <span className="ml-2 text-xs text-muted">to your team</span>}
                        {s.content && <span className="ml-2 text-xs text-muted">· edited</span>}
                        {s.def.note && <span className="block text-xs text-muted">{s.def.note}</span>}
                      </td>
                      <td className="px-4 py-3 text-muted">
                        {TYPE[s.def.category]}
                        {s.def.required && <span className="block text-[11px] uppercase tracking-wide">Required</span>}
                      </td>
                      <td className="px-4 py-3 text-muted">{trigger(s)}</td>
                      <td className="px-4 py-3">{s.enabled ? <Pill tone="ok">On</Pill> : <Pill tone="off">Off</Pill>}</td>
                      <td className="px-4 py-3">
                        <Link href={`/admin/emails/${s.def.key}`} className="underline hover:no-underline">
                          Edit
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      <section className="border border-dashed border-line px-5 py-4 text-sm">
        <h2 className="font-medium">Coming later</h2>
        <p className="mt-1 text-muted">
          The automation system has room for these; they are not built yet: {PLANNED_TRIGGERS.join(', ')}.
        </p>
      </section>
    </>
  )
}
