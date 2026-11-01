'use client'

/* The price under the product's name. It follows the flavour and size the
   customer chooses below (they announce the choice through VARIANT_EVENT),
   so a 1800 g tub shows its own price there, not the cheapest size of the
   product. Before a size is chosen it shows the chosen flavour's price, or
   "From" the cheapest when that flavour comes in sizes at different prices. */

import { useEffect, useState } from 'react'
import { Price } from '@/components/ui'
import { flavourKey, VARIANT_EVENT, type VariantChoice } from '@/lib/variant-events'

type V = {
  id: string
  colorName: Record<string, string> | null
  colorHex: string | null
  listCents: number
  finalCents: number
  available: number
}

const FROM: Record<string, string> = { en: 'From', el: 'Από', ru: 'От' }

export function PdpPrice({ variants, locale, currency, fallback }: { variants: V[]; locale: string; currency: string; fallback: { listCents: number; finalCents: number } }) {
  /* The same first choice the flavour buttons start with: the first flavour,
     and its size when it has only one in stock. */
  const [choice, setChoice] = useState<VariantChoice>(() => {
    const first = variants[0] ? flavourKey(variants[0]) : ''
    const sizes = variants.filter((v) => flavourKey(v) === first && v.available > 0)
    return { flavour: first, variantId: sizes.length === 1 ? sizes[0].id : null }
  })

  useEffect(() => {
    const on = (e: Event) => setChoice((e as CustomEvent<VariantChoice>).detail)
    window.addEventListener(VARIANT_EVENT, on)
    return () => window.removeEventListener(VARIANT_EVENT, on)
  }, [])

  const chosen = choice.variantId ? variants.find((v) => v.id === choice.variantId) : undefined
  const ofFlavour = variants.filter((v) => flavourKey(v) === choice.flavour)
  const pool = chosen ? [chosen] : ofFlavour.length ? ofFlavour : variants
  const inStock = pool.filter((v) => v.available > 0)
  const from = inStock.length ? inStock : pool
  const best = from.reduce<V | null>((b, v) => (!b || v.finalCents < b.finalCents ? v : b), null)
  const several = !chosen && new Set(from.map((v) => v.finalCents)).size > 1

  return (
    <span className="flex items-baseline gap-2">
      {several && <span className="text-sm text-muted">{FROM[locale] ?? FROM.en}</span>}
      <Price listCents={best?.listCents ?? fallback.listCents} finalCents={best?.finalCents ?? fallback.finalCents} locale={locale} currency={currency} size="lg" />
    </span>
  )
}
