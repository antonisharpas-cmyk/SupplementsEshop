/* ============================================================================
 * Partners: everyone who earns commission on their promo codes, with the
 * numbers for the chosen period and what is still owed to them.
 * ========================================================================== */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { listPartners } from '@/lib/partners'
import { readPeriod } from '@/lib/period'
import { formatMoney } from '@/lib/pricing'
import { PeriodFilter } from '@/components/PeriodFilter'
import { ReturnDaysForm } from '@/components/admin/PartnerAdmin'
import { Empty, PageHead, Stat, Table } from '@/components/admin/ui'
import { HBarChart } from '@/components/admin/charts'

export const dynamic = 'force-dynamic'

type SP = Record<string, string | string[] | undefined>
const eur = (c: number) => formatMoney(c, 'en')

export default async function AdminPartnersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/partners')
  const period = readPeriod(await searchParams)
  const { partners, returnDays } = await listPartners(period)
  const total = partners.reduce(
    (t, p) => ({ sales: t.sales + p.salesCents, commission: t.commission + p.commissionCents, owed: t.owed + Math.max(0, p.allTime.owedCents) }),
    { sales: 0, commission: 0, owed: 0 },
  )

  return (
    <>
      <PageHead
        title="Partners"
        sub="Influencers, content creators, gyms or companies who earn a commission on orders with their promo codes. Commission is on the goods without VAT, after discounts, without delivery."
      />

      <div className="mb-6 rounded-2xl border border-line bg-paper p-4">
        <ReturnDaysForm days={returnDays} />
        <p className="mt-2 text-xs text-muted">
          To add a partner, open the customer in{' '}
          <Link href="/admin/customers" className="underline">
            Customers
          </Link>{' '}
          and press Partner. Every partner also sees their own results in their account.
        </p>
      </div>

      <PeriodFilter path="/admin/partners" period={period} />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Stat label="Sales with partner codes (no VAT)" value={eur(total.sales)} />
        <Stat label="Commission in this period" value={eur(total.commission)} />
        <Stat label="Owed to partners now" value={eur(total.owed)} tone={total.owed > 0 ? 'warn' : 'plain'} />
      </div>

      {partners.some((p) => p.commissionCents > 0) && (
        <div className="mb-6 rounded-2xl border border-line bg-paper p-5">
          <h2 className="mb-4 text-sm font-semibold">Commission in this period</h2>
          <HBarChart
            format={eur}
            rows={partners
              .filter((p) => p.commissionCents > 0)
              .sort((a, b) => b.commissionCents - a.commissionCents)
              .map((p) => ({ label: p.name, value: p.commissionCents, note: `${p.orders} order${p.orders === 1 ? '' : 's'}, ${eur(p.salesCents)} sales` }))}
          />
        </div>
      )}

      {partners.length === 0 ? (
        <Empty>No partners yet.</Empty>
      ) : (
        <Table head={['Partner', 'Codes', 'Rate', 'Orders', 'Sales (no VAT)', 'Commission', 'Pending', 'Earned', 'Owed now']} rightFrom={3}>
          {partners.map((p) => (
            <tr key={p.id} className="hover:bg-paper-2">
              <td className="px-4 py-3">
                <Link href={`/admin/partners/${p.id}`} className="font-medium text-heading hover:underline">
                  {p.name}
                </Link>
                <div className="text-xs text-muted">{p.email}</div>
              </td>
              <td className="px-4 py-3 font-mono text-xs">{p.codes.join(', ') || <span className="text-muted">none yet</span>}</td>
              <td className="px-4 py-3 tabular-nums">{p.rateBp / 100}%</td>
              <td className="px-4 py-3 text-right tabular-nums">{p.orders}</td>
              <td className="px-4 py-3 text-right tabular-nums">{eur(p.salesCents)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{eur(p.commissionCents)}</td>
              <td className="px-4 py-3 text-right tabular-nums text-muted">{eur(p.pendingCents)}</td>
              <td className="px-4 py-3 text-right tabular-nums">{eur(p.earnedCents)}</td>
              <td className={`px-4 py-3 text-right font-semibold tabular-nums ${p.allTime.owedCents > 0 ? 'text-accent' : ''}`}>{eur(p.allTime.owedCents)}</td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 text-xs text-muted">
        Pending: not delivered yet, or still inside the {returnDays} return days. Earned: delivered and past them. Owed now: everything earned so far, minus what you paid, whatever the period.
      </p>
    </>
  )
}
