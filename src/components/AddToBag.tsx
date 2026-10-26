'use client'

/* ============================================================================
 * Size selection and add-to-bag — spec sections 7, 12 and 39.
 *
 * The important behaviour: the server owns availability. This component shows
 * what it was told at render time, but when the customer clicks Add, the POST
 * may still come back "no longer available" — because someone else took the
 * last one in between. That is the expected path, not an error case, and it is
 * handled by showing the real reason and marking the size sold out in place.
 *
 * Section 39 explicitly forbids solving this with a page reload. We update the
 * component's own state from the server's answer instead.
 * ========================================================================== */

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { announceBagCount } from '@/lib/bag-events'
import { announceVariant, flavourKey } from '@/lib/variant-events'

export type VariantOption = {
  id: string
  sku: string
  size: string
  colorName: Record<string, string> | null
  colorHex: string | null
  finalCents: number
  listCents: number
  available: number
  inStock: boolean
  isLowStock: boolean
}

export function AddToBag({
  locale,
  variants,
  reservationMinutes,
  soldOut = false,
}: {
  locale: Locale
  variants: VariantOption[]
  reservationMinutes: number
  /** The owner has marked the whole product sold out. The server refuses it
   *  anyway; this just says so before anyone tries. */
  soldOut?: boolean
}) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  /* Flavours, in the order the admin arranged them. Grouped by name, so one
     flavour in two sizes is one button with two sizes under it. */
  const colours = variants.reduce<{ key: string; hex: string | null; name: Record<string, string> | null }[]>(
    (acc, v) => {
      const key = flavourKey(v)
      if (!acc.some((c) => c.key === key)) acc.push({ key, hex: v.colorHex, name: v.colorName })
      return acc
    },
    [],
  )

  const [colour, setColour] = useState<string | null>(colours[0]?.key ?? null)
  /* With only one size to choose from, it is chosen already. */
  const onlySize = (key: string | null) => {
    const sizes = variants.filter((v) => flavourKey(v) === key && v.available > 0)
    return sizes.length === 1 ? sizes[0].id : null
  }
  const [variantId, setVariantId] = useState<string | null>(() => onlySize(colours[0]?.key ?? null))
  const [quantity, setQuantity] = useState(1)
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  /* Local overlay of what the server has told us since the page rendered, so a
     size that just sold out greys out without a reload. */
  const [liveAvailability, setLiveAvailability] = useState<Record<string, number>>({})

  const forColour = variants.filter((v) => flavourKey(v) === colour)
  const selected = forColour.find((v) => v.id === variantId) ?? null

  const availabilityOf = (v: VariantOption) =>
    liveAvailability[v.id] !== undefined ? liveAvailability[v.id] : v.available

  async function add() {
    if (!selected) {
      setMessage({ tone: 'error', text: t('pdp.sizeRequired') })
      return
    }
    setBusy(true)
    setMessage(null)

    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: selected.id, quantity, mode: 'add' }),
      })
      const data = (await res.json()) as {
        ok?: boolean
        error?: string
        message?: string
        available?: number
        cartCount?: number
      }

      if (!res.ok || !data.ok) {
        /* Reflect the server's truth in the UI immediately. */
        if (typeof data.available === 'number') {
          setLiveAvailability((prev) => ({ ...prev, [selected.id]: data.available! }))
          if (data.available === 0) setVariantId(null)
        }
        setMessage({ tone: 'error', text: data.message ?? t('err.generic') })
        return
      }

      setMessage({ tone: 'ok', text: t('pdp.added') })
      /* The header badge moves now; the refresh brings the rest along. */
      announceBagCount(data.cartCount)
      startTransition(() => router.refresh())
    } catch {
      setMessage({ tone: 'error', text: t('err.network') })
    } finally {
      setBusy(false)
    }
  }

  const anyInStock = !soldOut && forColour.some((v) => availabilityOf(v) > 0)

  /* Supplements are sold in several pack sizes at different prices, so each
     size shows its own price and the chosen one is repeated above the button. */
  const pricesDiffer = new Set(variants.map((v) => v.finalCents)).size > 1
  const money = (cents: number) =>
    new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
      style: 'currency',
      currency: 'EUR',
      minimumFractionDigits: 2,
    }).format(cents / 100)

  return (
    <div>
      {/* ------------------------------------------------------- colours -- */}
      {colours.length > 1 && (
        <fieldset className="mb-6">
          <legend className="label mb-2.5">
            {t('pdp.colour')}
          </legend>
          <div className="flex flex-wrap gap-2">
            {colours.map((c) => {
              const on = colour === c.key
              const gone = variants
                .filter((v) => flavourKey(v) === c.key)
                .every((v) => soldOut || availabilityOf(v) <= 0)
              return (
                <button
                  key={c.key || 'none'}
                  type="button"
                  onClick={() => {
                    const next = onlySize(c.key)
                    setColour(c.key)
                    setVariantId(next)
                    announceVariant({ flavour: c.key, variantId: next })
                  }}
                  aria-pressed={on}
                  title={gone ? t('pdp.colourSoldOut', { colour: c.name?.[locale] ?? c.name?.en ?? '' }) : undefined}
                  className={`flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm transition-colors ${
                    on
                      ? 'border-accent text-heading'
                      : 'border-line text-ink-soft hover:border-line-strong'
                  } ${gone ? 'opacity-50' : ''}`}
                >
                  <span
                    aria-hidden
                    className="h-3.5 w-3.5 shrink-0 rounded-full shadow-[inset_0_0_0_1px_rgba(255,255,255,.25)]"
                    style={{ backgroundColor: c.hex ?? '#555' }}
                  />
                  {c.name?.[locale] ?? c.name?.en ?? ''}
                </button>
              )
            })}
          </div>
        </fieldset>
      )}

      {/* --------------------------------------------------------- sizes -- */}
      <fieldset>
        <div className="mb-2.5 flex items-baseline justify-between">
          <legend className="label">{t('pdp.selectSize')}</legend>
        </div>

        <div className="flex flex-wrap gap-2">
          {forColour.map((v) => {
            const available = availabilityOf(v)
            const sizeGone = soldOut || available <= 0
            const active = variantId === v.id
            return (
              <button
                key={v.id}
                type="button"
                disabled={sizeGone}
                onClick={() => {
                  setVariantId(v.id)
                  announceVariant({ flavour: flavourKey(v), variantId: v.id })
                  setQuantity(1)
                  setMessage(null)
                }}
                aria-pressed={active}
                title={sizeGone ? t('pdp.outOfStockSize', { size: v.size }) : undefined}
                className={`relative min-w-16 overflow-hidden rounded-xl border px-3.5 py-3 text-sm transition-colors ${
                  sizeGone
                    ? 'cursor-not-allowed border-line text-line-strong'
                    : active
                      ? 'border-accent bg-accent font-semibold text-black'
                      : 'border-line hover:border-ink'
                }`}
              >
                <span className="block">{v.size}</span>
                {pricesDiffer && (
                  <span className={`mt-0.5 block text-[11px] ${active ? 'text-black/70' : 'text-muted'}`}>
                    {money(v.finalCents)}
                  </span>
                )}
                {sizeGone && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-0 grid place-items-center"
                  >
                    <span className="h-px w-full -rotate-12 bg-line-strong" />
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* stock nudge for the chosen size */}
        {selected && (
          <p className="mt-3 text-xs">
            {availabilityOf(selected) <= 0 ? (
              <span className="text-sale">{t('pdp.soldOut')}</span>
            ) : selected.isLowStock || availabilityOf(selected) <= 3 ? (
              <span className="text-sale">
                {t('pdp.lowStock', { n: availabilityOf(selected) })}
              </span>
            ) : (
              <span className="text-ok">{t('pdp.inStock')}</span>
            )}
            <span className="ml-3 text-muted">
              {t('pdp.sku')} {selected.sku}
            </span>
          </p>
        )}
      </fieldset>

      {/* ------------------------------------------------------ quantity -- */}
      {selected && availabilityOf(selected) > 1 && (
        <div className="mt-6 flex items-center gap-3">
          <span className="label">{t('pdp.quantity')}</span>
          <div className="flex items-center overflow-hidden rounded-full border border-line">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              className="h-11 w-11 text-lg hover:bg-paper-2"
              aria-label="−"
            >
              −
            </button>
            <span className="w-10 text-center text-sm font-medium">{quantity}</span>
            <button
              type="button"
              onClick={() =>
                setQuantity((q) => Math.min(Math.min(20, availabilityOf(selected)), q + 1))
              }
              className="h-11 w-11 text-lg hover:bg-paper-2"
              aria-label="+"
            >
              +
            </button>
          </div>
        </div>
      )}

      {/* ----------------------------------------------------------- add -- */}
      {selected && pricesDiffer && (
        <p className="mt-6 flex items-baseline gap-2 text-xl">
          <span className={selected.finalCents < selected.listCents ? 'font-semibold text-sale' : 'font-semibold text-heading'}>
            {money(selected.finalCents * quantity)}
          </span>
          {selected.finalCents < selected.listCents && (
            <span className="text-sm text-muted line-through">{money(selected.listCents * quantity)}</span>
          )}
        </p>
      )}
      <button
        type="button"
        onClick={add}
        disabled={busy || pending || !anyInStock}
        className="btn btn-primary btn-lg mt-7 w-full"
      >
        {!anyInStock
          ? t('pdp.soldOut')
          : busy
            ? t('pdp.adding')
            : t('pdp.addToBag')}
      </button>

      {!anyInStock && (
        <div className="mt-4 border border-line bg-paper-2 px-4 py-3.5">
          <p className="label">{t('pdp.soldOutTitle')}</p>
          <p className="mt-1.5 text-sm text-ink-soft">{t('pdp.soldOutBody')}</p>
          <button
            type="button"
            onClick={() => window.dispatchEvent(new CustomEvent('support:open'))}
            className="mt-2.5 text-sm underline underline-offset-4 hover:text-ink-soft"
          >
            {t('pdp.askRestock')}
          </button>
        </div>
      )}

      {message && (
        <p
          role="status"
          aria-live="polite"
          className={`mt-3 text-sm ${message.tone === 'ok' ? 'text-ok' : 'text-sale'}`}
        >
          {message.text}
        </p>
      )}

      <p className="mt-3 text-xs text-muted">
        {t('pdp.reserved', { minutes: reservationMinutes })}
      </p>
    </div>
  )
}
