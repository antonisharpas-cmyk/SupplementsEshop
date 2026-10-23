/* Wholesale prices: for every retailer, or one retailer's own. */

import Link from 'next/link'
import { guardFinance } from '@/lib/admin'
import { listRetailers, priceList, pricesFor, wholesalePrice } from '@/lib/wholesale'
import { stockWithCosts, variantLabel } from '@/lib/stock'
import { getSettings } from '@/lib/settings'
import { UUID } from '@/lib/api'
import { PriceEditor } from '@/components/admin/finance/PriceEditor'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Wholesale prices' }

export default async function PricesPage({ searchParams }: { searchParams: Promise<{ retailer?: string }> }) {
  await guardFinance('/admin/wholesale/prices')
  const { retailer } = await searchParams
  const retailers = (await listRetailers()).map((r) => r.retailer)
  const chosen = retailer && UUID.test(retailer) ? retailers.find((r) => r.id === retailer) : undefined
  const { vat_rate_bp } = await getSettings(['vat_rate_bp'])
  const net = (gross: number) => Math.round(gross / (1 + vat_rate_bp / 10_000))

  let rows
  if (chosen) {
    const list = await priceList(chosen.id)
    rows = list.map((p) => ({
      variantId: p.variantId,
      label: p.label,
      sku: p.sku,
      retailGrossCents: p.retailGrossCents,
      netRetailCents: net(p.retailGrossCents),
      avgCostCents: p.avgCostCents,
      fixedCents: p.ownCents,
      ...(p.generalCents !== null
        ? { fallbackCents: p.generalCents, fallbackLabel: 'general price' }
        : { fallbackCents: wholesalePrice({ retailGrossCents: p.retailGrossCents, vatRateBp: vat_rate_bp, discountPercent: chosen.defaultDiscountPercent }).unitNetCents, fallbackLabel: `${chosen.defaultDiscountPercent}% off` }),
    }))
  } else {
    const [stock, general] = await Promise.all([stockWithCosts(), pricesFor(null)])
    const g = new Map(general.map((p) => [p.variantId, p.unitNetCents]))
    rows = stock.map((v) => ({
      variantId: v.variantId,
      label: variantLabel(v),
      sku: v.sku,
      retailGrossCents: v.priceCents,
      netRetailCents: net(v.priceCents),
      avgCostCents: v.avgCostCents,
      fixedCents: g.get(v.variantId) ?? null,
      fallbackCents: net(v.priceCents),
      fallbackLabel: "each retailer's discount",
    }))
  }
  const pill = (on: boolean) => `inline-flex items-center rounded-full border px-4 py-2 text-sm ${on ? 'border-transparent bg-gold text-black' : 'border-line bg-paper hover:border-line-strong'}`
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/admin/wholesale/prices" className={pill(!chosen)}>
          General (every retailer)
        </Link>
        {retailers.map((r) => (
          <Link key={r.id} href={`/admin/wholesale/prices?retailer=${r.id}`} className={pill(chosen?.id === r.id)}>
            {r.name}
          </Link>
        ))}
      </div>
      <p className="mb-5 max-w-3xl text-sm text-muted">
        {chosen
          ? `Prices for ${chosen.name} only, before VAT. Leave empty to use the general price, or if there is none, ${chosen.defaultDiscountPercent}% off the website price before VAT.`
          : 'Fixed wholesale prices for every retailer, before VAT. Leave empty to use each retailer’s default discount off the website price. A retailer’s own price always comes first.'}
      </p>
      <PriceEditor key={chosen?.id ?? 'general'} retailerId={chosen?.id ?? null} rows={rows} />
    </>
  )
}
