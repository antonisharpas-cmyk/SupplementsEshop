/* One sale to a retailer: lines, invoice and credit notes, payments. */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guardFinance } from '@/lib/admin'
import { getSale } from '@/lib/wholesale'
import { attachmentsOf } from '@/lib/finance'
import { formatMoney } from '@/lib/pricing'
import { UUID } from '@/lib/api'
import { Pill, Table, btn } from '@/components/admin/ui'
import { SaleActions } from '@/components/admin/finance/SaleActions'
import { FileBox } from '@/components/admin/finance/FileBox'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Wholesale sale' }

export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await guardFinance(`/admin/wholesale/${id}`)
  if (!UUID.test(id)) notFound()
  const s = await getSale(id)
  if (!s) notFound()
  const files = await attachmentsOf('wholesale', [id])
  const money = (c: number) => formatMoney(Math.round(c), 'en')
  const profit = s.sale.netCents - s.sale.costCents

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/wholesale" className={btn.quiet}>
            ← Wholesale
          </Link>
          <h2 className="mt-3 text-xl font-semibold">
            <span className="font-mono">{s.sale.number}</span> · {s.retailer.name}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {s.sale.saleDate} · due by {s.sale.dueDate}
            {s.sale.remindersSent > 0 && ` · ${s.sale.remindersSent} reminder${s.sale.remindersSent === 1 ? '' : 's'} sent`}
          </p>
          <div className="mt-2">{s.balance.dueCents === 0 ? <Pill tone="ok">Paid</Pill> : <Pill tone={s.overdue ? 'bad' : 'warn'}>{`${money(s.balance.dueCents)} ${s.overdue ? 'overdue' : 'still due'}`}</Pill>}</div>
        </div>
        <div className="flex flex-wrap gap-2">
          {s.docs.map((d) => (
            <Link key={d.id} href={`/admin/accounting/${d.id}`} className={d.kind === 'INVOICE' ? btn.primary : btn.secondary}>
              {d.kind === 'INVOICE' ? 'Invoice' : 'Credit note'} {d.number}
            </Link>
          ))}
        </div>
      </div>

      <Table head={['Product', 'Qty', 'Returned', 'Price before VAT', 'Line', 'Cost / unit', 'Margin']} rightFrom={1}>
        {s.lines.map((l) => (
          <tr key={l.id}>
            <td className="px-4 py-3">
              {l.description} <span className="font-mono text-[11px] text-muted">{l.sku}</span>
            </td>
            <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
            <td className="px-4 py-3 text-right tabular-nums">{l.returnedQuantity || '—'}</td>
            <td className="px-4 py-3 text-right tabular-nums">{money(l.unitNetCents)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{money(l.lineNetCents)}</td>
            <td className="px-4 py-3 text-right tabular-nums text-muted">{money(l.unitCostCents)}</td>
            <td className="px-4 py-3 text-right tabular-nums">{l.unitNetCents > 0 ? `${Math.round(((l.unitNetCents - l.unitCostCents) / l.unitNetCents) * 100)}%` : '—'}</td>
          </tr>
        ))}
      </Table>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
        <SaleActions
          id={id}
          dueCents={s.balance.dueCents}
          hasEmail={Boolean(s.retailer.email)}
          lines={s.lines.map((l) => ({ id: l.id, description: l.description, quantity: l.quantity, unitNetCents: l.unitNetCents }))}
          payments={s.payments}
        />
        <div className="space-y-6">
          <div className="space-y-2 rounded-2xl border border-line bg-paper p-5 text-sm">
            <Row label="Net" value={money(s.sale.netCents)} />
            <Row label={`VAT ${s.sale.vatRateBp / 100}%`} value={money(s.sale.vatCents)} />
            <Row label="Invoice total" value={money(s.sale.totalCents)} bold />
            {s.balance.creditedCents > 0 && <Row label="Credited" value={`−${money(s.balance.creditedCents)}`} />}
            {s.balance.paidCents > 0 && <Row label="Paid" value={`−${money(s.balance.paidCents)}`} />}
            <Row label="Still due" value={money(s.balance.dueCents)} bold />
            <p className="pt-3 text-xs text-muted">
              Profit {money(profit)} {s.sale.netCents > 0 && `(${Math.round((profit / s.sale.netCents) * 100)}%)`} on stock that cost {money(s.sale.costCents)}.
            </p>
          </div>
          <FileBox type="wholesale" id={id} files={files} label="Files (their order, delivery note)" />
        </div>
      </div>
    </>
  )
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? 'border-t border-line pt-2 font-semibold' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
