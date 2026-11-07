/* ============================================================================
 * One partner: switch partner on or off with the commission, choose their
 * promo codes, see results per code for a period, and record payments.
 * Opens for any customer account, so a customer can be made a partner here.
 * ========================================================================== */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { users } from '@/db/schema'
import { guardAdmin } from '@/lib/admin'
import { codeChoices, partnerReport } from '@/lib/partners'
import { readPeriod } from '@/lib/period'
import { formatMoney } from '@/lib/pricing'
import { PeriodFilter } from '@/components/PeriodFilter'
import { DeletePayout, PartnerCodes, PartnerSwitch, PayoutForm } from '@/components/admin/PartnerAdmin'
import { Empty, PageHead, Stat, Table } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>
const eur = (c: number) => formatMoney(c, 'en')

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 rounded-2xl border border-line bg-paper p-5">
      <h2 className="mb-4 text-base font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export default async function AdminPartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await guardAdmin('/admin/partners')
  const { id } = await params
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound()
  const [user] = await db
    .select({ id: users.id, firstName: users.firstName, lastName: users.lastName, email: users.email, isPartner: users.isPartner, rateBp: users.partnerRateBp })
    .from(users)
    .where(eq(users.id, id))
    .limit(1)
  if (!user) notFound()
  const period = readPeriod(await searchParams)
  const [report, codes] = await Promise.all([partnerReport(id, period), codeChoices()])
  const names = new Map<string, string>()
  if (codes.some((c) => c.partnerUserId && c.partnerUserId !== id)) {
    const others = await db.select({ id: users.id, firstName: users.firstName, lastName: users.lastName }).from(users).where(eq(users.isPartner, true))
    for (const o of others) names.set(o.id, `${o.firstName} ${o.lastName}`.trim())
  }

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/admin/partners" className="text-muted hover:underline">
          ← Partners
        </Link>
      </p>
      <PageHead
        title={`${user.firstName} ${user.lastName}`.trim()}
        sub={
          <>
            {user.email} ·{' '}
            <Link href={`/admin/customers/${id}`} className="underline">
              customer account
            </Link>
          </>
        }
      />

      <Section title="Partner">
        <PartnerSwitch id={id} isPartner={user.isPartner} ratePercent={user.rateBp / 100} />
      </Section>

      {report && (
        <>
          <Section title="Their promo codes">
            <PartnerCodes id={id} codes={codes.map((c) => ({ ...c, partnerName: c.partnerUserId ? names.get(c.partnerUserId) : null }))} />
          </Section>

          <PeriodFilter path={`/admin/partners/${id}`} period={period} />
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Orders" value={report.totals.orders} />
            <Stat label="Sales (no VAT)" value={eur(report.totals.salesCents)} />
            <Stat label="Commission" value={eur(report.totals.commissionCents)} />
            <Stat label={`Pending (${report.returnDays} return days)`} value={eur(report.totals.pendingCents)} />
          </div>
          {report.codes.length === 0 ? (
            <Empty>No promo code is linked yet.</Empty>
          ) : (
            <Table head={['Code', 'Orders', 'Sales (no VAT)', 'Commission', 'Pending', 'Earned']} rightFrom={1}>
              {report.codes.map((c) => (
                <tr key={c.codeId}>
                  <td className="px-4 py-3 font-mono">{c.code}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{c.orders}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{eur(c.salesCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{eur(c.commissionCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted">{eur(c.pendingCents)}</td>
                  <td className="px-4 py-3 text-right tabular-nums">{eur(c.earnedCents)}</td>
                </tr>
              ))}
            </Table>
          )}

          <div className="mt-8">
            <Section title="Payments">
              <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label="Earned so far" value={eur(report.allTime.earnedCents)} />
                <Stat label="Paid so far" value={eur(report.allTime.paidCents)} />
                <Stat label="Owed now" value={eur(report.allTime.owedCents)} tone={report.allTime.owedCents > 0 ? 'warn' : 'plain'} />
              </div>
              <PayoutForm id={id} owedCents={report.allTime.owedCents} />
              {report.payouts.length > 0 && (
                <ul className="mt-5 divide-y divide-[var(--color-line)] text-sm">
                  {report.payouts.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span>
                        <span className="tabular-nums">{p.paidOn}</span>
                        {p.note && <span className="text-muted"> · {p.note}</span>}
                      </span>
                      <span className="flex items-center gap-4">
                        <span className="font-semibold tabular-nums">{eur(p.amountCents)}</span>
                        <DeletePayout id={id} payoutId={p.id} />
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Section>
          </div>
        </>
      )}
    </>
  )
}
