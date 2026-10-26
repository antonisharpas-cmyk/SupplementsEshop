/* Who the shop buys from. */

import { guardFinance } from '@/lib/admin'
import { listSuppliers } from '@/lib/purchases'
import { VAT_TREATMENTS, type VatTreatment } from '@/lib/finance'
import { formatMoney } from '@/lib/pricing'
import { Empty, Pill } from '@/components/admin/ui'
import { SupplierForm } from '@/components/admin/finance/SupplierForm'
import { Paged } from '@/components/admin/Paged'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Suppliers' }

export default async function SuppliersPage() {
  await guardFinance('/admin/purchases/suppliers')
  const list = await listSuppliers()
  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-paper p-5">
        <h2 className="label mb-4 text-muted">Add a supplier</h2>
        <SupplierForm />
      </section>
      {list.length === 0 ? (
        <Empty>No suppliers yet. Add Olimp and the retailers you buy other brands from.</Empty>
      ) : (
        <Paged className="space-y-3">
          {list.map(({ supplier: s, purchases, spentCents, lastDate }) => (
            <details key={s.id} className="group rounded-2xl border border-line bg-paper">
              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4">
                <span>
                  <span className="font-semibold">{s.name}</span>
                  <span className="ml-2 text-xs text-muted">
                    {s.country} · {VAT_TREATMENTS[s.vatTreatment as VatTreatment]?.label} {s.vatNumber ? `· ${s.vatNumber}` : ''}
                  </span>
                </span>
                <span className="flex items-center gap-4 text-xs text-muted">
                  <span>{purchases} purchases</span>
                  <span>{formatMoney(spentCents, 'en')} received</span>
                  {lastDate && <span>last {lastDate}</span>}
                  {!s.isActive && <Pill tone="off">Inactive</Pill>}
                  <span className="text-accent group-open:hidden">Edit</span>
                </span>
              </summary>
              <div className="border-t border-line p-5">
                <SupplierForm initial={s} />
              </div>
            </details>
          ))}
        </Paged>
      )}
    </div>
  )
}
