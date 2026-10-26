/* One purchase: the supplier's invoice, the true cost of each unit, the files. */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { canSeeFinance, guardAdmin } from '@/lib/admin'
import { getPurchase, listSuppliers } from '@/lib/purchases'
import { attachmentsOf, VAT_TREATMENTS, type VatTreatment } from '@/lib/finance'
import { stockWithCosts, variantLabel } from '@/lib/stock'
import { getSettings } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { UUID } from '@/lib/api'
import { Pill, Table, btn } from '@/components/admin/ui'
import { PurchaseActions } from '@/components/admin/finance/PurchaseActions'
import { PurchaseForm } from '@/components/admin/finance/PurchaseForm'
import { FileBox } from '@/components/admin/finance/FileBox'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Purchase' }

export default async function PurchasePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ edit?: string }> }) {
  const { id } = await params
  const user = await guardAdmin(`/admin/purchases/${id}`)
  if (!UUID.test(id)) notFound()
  const found = await getPurchase(id)
  if (!found) notFound()
  const finance = canSeeFinance(user)
  const { purchase: p, supplier, lines } = found
  const money = (c: number) => formatMoney(Math.round(c), 'en')

  if ((await searchParams).edit === '1' && finance && p.status === 'DRAFT') {
    const [suppliers, stock, { vat_rate_bp }] = await Promise.all([listSuppliers(), stockWithCosts(), getSettings(['vat_rate_bp'])])
    return (
      <>
        <h2 className="mb-5 text-lg font-semibold">Edit {p.number}</h2>
        <PurchaseForm
          suppliers={suppliers.map((s) => ({ id: s.supplier.id, name: s.supplier.name, vatTreatment: s.supplier.vatTreatment, country: s.supplier.country }))}
          variants={stock.map((v) => ({ variantId: v.variantId, label: variantLabel(v), sku: v.sku, supplierCode: v.supplierCode, avgCostCents: v.avgCostCents, onHand: v.onHand }))}
          vatRateBp={vat_rate_bp}
          initial={{ ...p, lines }}
        />
      </>
    )
  }

  const files = finance ? await attachmentsOf('purchase', [p.id]) : []
  const units = lines.reduce((n, l) => n + l.quantity + l.freeQuantity, 0)

  return (
    <>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link href="/admin/purchases" className={btn.quiet}>
            ← Purchases
          </Link>
          <h2 className="mt-3 text-xl font-semibold">
            <span className="font-mono">{p.number}</span> · {supplier.name}
          </h2>
          <p className="mt-1 text-sm text-muted">
            Invoice {p.supplierInvoiceNo ?? 'without a number'} of {p.invoiceDate} · {units} units ·{' '}
            {VAT_TREATMENTS[p.vatTreatment as VatTreatment]?.label ?? p.vatTreatment}
          </p>
          <div className="mt-2 flex gap-1">
            <Pill tone={p.status === 'RECEIVED' ? 'ok' : 'warn'}>{p.status === 'RECEIVED' ? `Received ${p.receivedAt?.toISOString().slice(0, 10) ?? ''}` : 'Not arrived yet'}</Pill>
            {finance && <Pill tone={p.paidAt ? 'off' : 'bad'}>{p.paidAt ? `Paid ${p.paidAt.toISOString().slice(0, 10)}` : 'Unpaid'}</Pill>}
          </div>
        </div>
        <PurchaseActions id={p.id} status={p.status} paid={Boolean(p.paidAt)} finance={finance} />
      </div>

      <Table head={finance ? ['Product', 'SKU', 'Qty', 'Free', 'Unit price', 'Line', 'True cost / unit'] : ['Product', 'SKU', 'Qty', 'Free']} rightFrom={2}>
        {lines.map((l) => (
          <tr key={l.id}>
            <td className="px-4 py-3">{l.description}</td>
            <td className="px-4 py-3 font-mono text-xs text-muted">{l.sku ?? '—'}</td>
            <td className="px-4 py-3 text-right tabular-nums">{l.quantity}</td>
            <td className="px-4 py-3 text-right tabular-nums">{l.freeQuantity || '—'}</td>
            {finance && (
              <>
                <td className="px-4 py-3 text-right tabular-nums">{money(l.unitNetCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums">{money(l.lineNetCents)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium">{l.landedUnitCents === null ? <span className="text-muted">when received</span> : money(l.landedUnitCents)}</td>
              </>
            )}
          </tr>
        ))}
      </Table>

      {finance && (
        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[1fr_22rem]">
          <FileBox type="purchase" id={p.id} files={files} label="Supplier invoice and files" />
          <div className="space-y-2 rounded-2xl border border-line bg-paper p-5 text-sm">
            <Line label="Products" value={money(p.goodsNetCents)} />
            <Line label="Shipping" value={money(p.shippingCents)} />
            <Line label="Other fees" value={money(p.otherFeesCents)} />
            {p.reverseVatCents > 0 ? <Line label="Reverse charge VAT (not paid)" value={money(p.reverseVatCents)} muted /> : <Line label="VAT" value={money(p.vatCents)} />}
            <div className="flex justify-between border-t border-line pt-3 text-base font-semibold">
              <span>To pay the supplier</span>
              <span className="tabular-nums">{money(p.totalCents)}</span>
            </div>
            {p.note && <p className="pt-3 text-xs text-muted">{p.note}</p>}
          </div>
        </div>
      )}
    </>
  )
}

function Line({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted' : ''}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  )
}
