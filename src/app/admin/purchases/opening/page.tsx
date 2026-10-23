/* Today's stock and what it cost, loaded once from a sheet. */

import { guardFinance } from '@/lib/admin'
import { stockValue } from '@/lib/stock'
import { formatMoney } from '@/lib/pricing'
import { Stat } from '@/components/admin/ui'
import { OpeningStock } from '@/components/admin/finance/OpeningStock'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Opening stock' }

export default async function OpeningPage() {
  await guardFinance('/admin/purchases/opening')
  const v = await stockValue()
  return (
    <>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Units in stock" value={v.units} />
        <Stat label="Stock value at cost" value={formatMoney(v.valueCents, 'en')} />
        <Stat label="Products in stock without a cost" value={v.uncosted} tone={v.uncosted > 0 ? 'warn' : 'plain'} />
      </div>
      <p className="mb-6 max-w-3xl text-sm text-muted">
        Do this once, so profit is right from the first day: it sets each product’s stock to what you counted and its cost to what you paid. After that, purchases keep both up to date by themselves. You can run it again for a full stock take.
      </p>
      <OpeningStock />
    </>
  )
}
