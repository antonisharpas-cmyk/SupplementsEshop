'use client'

/* ============================================================================
 * The stock editor: one line per variant (product × colour × size).
 *
 *   click the number → type → Enter      saves that line, moves to the next
 *   ↑ / ↓                                move between lines (a changed line
 *                                        saves as you leave it)
 *   Escape                               put the line back
 *   click away                           saves too
 *
 * There is no "Save all": a shop counting stock works one line at a time, and
 * losing a screenful of edits to one mis-click is unforgivable.
 *
 * The number typed is the PHYSICAL count on the shelf. Available = on shelf −
 * held in live carts, and the server computes it — the screen shows what the
 * server returned, never its own arithmetic. A count below what carts hold is
 * refused by the server, and the refusal is shown next to the line.
 *
 * Lines do not jump around after a save (fixing a "needs attention" line does
 * not make it vanish under your cursor); the list re-sorts when you change
 * view or reload.
 * ========================================================================== */

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { StockRow } from '@/lib/admin-catalog'
import { StatusBadge, StockCount, Swatch, Thumb } from './ui'

type LineState = {
  value: string
  status: 'idle' | 'saving' | 'saved' | 'error'
  message?: string
  onHand: number
  reserved: number
  available: number
}

export type StockLine = Pick<
  StockRow,
  | 'variantId'
  | 'productId'
  | 'productName'
  | 'image'
  | 'category'
  | 'colourName'
  | 'colourHex'
  | 'size'
  | 'sku'
  | 'onHand'
  | 'reserved'
  | 'available'
  | 'productStatus'
>

export function StockEditor({
  lines,
  lowStockThreshold: low,
  compact = false,
}: {
  lines: StockLine[]
  lowStockThreshold: number
  /** Inside one product's editor: no image / product / status columns. */
  compact?: boolean
}) {
  const fromLine = (l: StockLine): LineState => ({
    value: String(l.onHand),
    status: 'idle' as const,
    onHand: l.onHand,
    reserved: l.reserved,
    available: l.available,
  })
  const [state, setState] = useState<Record<string, LineState>>(() =>
    Object.fromEntries(lines.map((l) => [l.variantId, fromLine(l)])),
  )
  /* The counts above the list (low, sold out, needs attention) come from the
     server: bring them up to date a few seconds after the last save, so
     typing down the list is not interrupted. */
  const router = useRouter()
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshSoon = () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      if (inFlight.current.size === 0) router.refresh()
    }, 4000)
  }
  useEffect(() => () => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
  }, [])
  const inputs = useRef<(HTMLInputElement | null)[]>([])

  const patch = (id: string, next: Partial<LineState>) => setState((s) => ({ ...s, [id]: { ...s[id], ...next } }))

  const focusLine = (index: number) => {
    const el = inputs.current[index]
    if (el) {
      el.focus()
      el.select()
    }
  }

  const inFlight = useRef(new Set<string>())

  async function save(line: StockLine) {
    if (inFlight.current.has(line.variantId)) return
    const row = state[line.variantId] ?? fromLine(line)
    const typed = row.value.trim()
    if (!/^\d+$/.test(typed)) {
      patch(line.variantId, {
        status: 'error',
        message: 'A whole number, zero or more.',
      })
      return
    }
    const parsed = Number(typed)
    if (parsed === row.onHand) {
      patch(line.variantId, {
        status: row.status === 'saved' ? 'saved' : 'idle',
        message: undefined,
        value: String(parsed),
      })
      return
    }

    patch(line.variantId, { status: 'saving', message: undefined })
    inFlight.current.add(line.variantId)
    try {
      const res = await fetch('/api/admin/stock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ variantId: line.variantId, onHand: parsed }),
      })
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean
        message?: string
        onHand?: number
        reserved?: number
        available?: number
      }
      if (!res.ok || !data.ok) {
        /* Back to the stored number: the screen never shows a figure the
           database does not have. */
        patch(line.variantId, {
          status: 'error',
          message: data.message ?? 'Could not save that.',
          value: String(row.onHand),
        })
        return
      }
      const onHand = data.onHand ?? parsed
      const reserved = data.reserved ?? row.reserved
      patch(line.variantId, {
        status: 'saved',
        onHand,
        reserved,
        available: data.available ?? onHand - reserved,
        value: String(onHand),
        message: undefined,
      })
      refreshSoon()
    } catch {
      patch(line.variantId, {
        status: 'error',
        message: 'Could not reach the server.',
        value: String(row.onHand),
      })
    } finally {
      inFlight.current.delete(line.variantId)
    }
  }

  const cols = compact
    ? 'md:grid-cols-[minmax(0,1.3fr)_4.5rem_minmax(0,1.2fr)_6.5rem_4.5rem_6rem_minmax(0,1fr)]'
    : 'md:grid-cols-[3rem_minmax(0,2fr)_minmax(0,1.1fr)_4rem_minmax(0,1.1fr)_6.5rem_3.5rem_6.5rem_7.5rem_3rem]'

  return (
    <div className="border border-line bg-paper">
      <div aria-hidden className={`hidden gap-4 border-b border-line px-4 py-3 label text-muted md:grid ${cols}`}>
        {!compact && <span />}
        {!compact && <span>Product</span>}
        <span>Flavour</span>
        <span>Size</span>
        <span>SKU</span>
        <span>On shelf</span>
        <span>Held</span>
        <span>Available</span>
        {!compact ? <span>Product status</span> : <span />}
        {!compact && <span />}
      </div>

      <ul className="divide-y divide-[var(--color-line)]">
        {lines.map((line, index) => {
          const row = state[line.variantId] ?? fromLine(line)
          const tint =
            row.status === 'error'
              ? 'bg-sale/5'
              : row.available <= 0
                ? 'bg-sale/[0.03]'
                : row.available <= low
                  ? 'bg-amber-500/[0.05]'
                  : ''
          return (
            <li
              key={line.variantId}
              className={`grid ${compact ? 'grid-cols-1' : 'grid-cols-[3rem_minmax(0,1fr)_auto]'} items-center gap-x-4 gap-y-1.5 px-4 py-3 text-sm md:gap-y-0 ${cols} ${tint}`}
            >
              {!compact && (
                <span className="row-span-4 md:row-span-1">
                  <Thumb src={line.image} alt="" size="sm" />
                </span>
              )}
              {!compact && (
                <span className="min-w-0">
                  <Link
                    href={`/admin/products/${line.productId}`}
                    className="block truncate font-medium hover:underline"
                  >
                    {line.productName}
                  </Link>
                  <span className="block truncate text-xs text-muted">{line.category}</span>
                </span>
              )}

              <span className={`min-w-0 truncate ${compact ? '' : 'col-start-2 md:col-start-auto'}`}>
                <Swatch name={line.colourName} hex={line.colourHex} />
                <span className="ml-2 font-medium md:hidden">· {line.size}</span>
              </span>
              <span className="hidden font-medium md:block">{line.size}</span>
              <span
                className={`truncate font-mono text-xs text-muted ${compact ? '' : 'col-start-2 md:col-start-auto'}`}
              >
                {line.sku}
              </span>

              {/* On a phone the three numbers share one line; from md up
                  `contents` hands each back to its own grid column. */}
              <span
                className={`flex flex-wrap items-center gap-x-5 gap-y-2 md:contents ${compact ? '' : 'col-span-2 col-start-2'}`}
              >
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted md:hidden">On shelf</span>
                  <input
                    ref={(el) => {
                      inputs.current[index] = el
                    }}
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    aria-label={`On the shelf: ${line.productName}, ${line.colourName ?? ''} ${line.size}`}
                    aria-invalid={row.status === 'error'}
                    value={row.value}
                    disabled={row.status === 'saving'}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) =>
                      patch(line.variantId, {
                        value: e.target.value,
                        status: 'idle',
                        message: undefined,
                      })
                    }
                    onBlur={() => void save(line)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        /* Leaving the field is what saves it (onBlur), so
                         Enter only has to move on, or let go on the last. */
                        if (inputs.current[index + 1]) focusLine(index + 1)
                        else e.currentTarget.blur()
                      } else if (e.key === 'ArrowDown') {
                        e.preventDefault()
                        focusLine(index + 1)
                      } else if (e.key === 'ArrowUp') {
                        e.preventDefault()
                        focusLine(index - 1)
                      } else if (e.key === 'Escape') {
                        patch(line.variantId, {
                          value: String(row.onHand),
                          status: 'idle',
                          message: undefined,
                        })
                      }
                    }}
                    className={`w-20 border bg-paper px-2.5 py-2 text-right tabular-nums outline-none transition-colors hover:border-ink focus:border-accent ${
                      row.status === 'error' ? 'border-sale' : 'border-line'
                    }`}
                  />
                </span>

                <span className="tabular-nums text-muted">
                  <span className="text-xs md:hidden">Held </span>
                  {row.reserved}
                </span>
                <span>
                  <span className="mr-1 text-xs text-muted md:hidden">Available</span>
                  <StockCount available={row.available} low={low} />
                </span>
              </span>

              <span className={`min-w-0 ${compact ? '' : 'col-start-2 md:col-start-auto'}`}>
                {row.status === 'saving' && <span className="text-xs text-muted">Saving…</span>}
                {row.status === 'saved' && <span className="text-xs text-ok">Saved ✓</span>}
                {row.status === 'error' && (
                  <span role="alert" className="block text-xs text-sale">
                    {row.message}
                  </span>
                )}
                {/* Only the exceptions: "Available" on every line is noise. */}
                {!compact && row.status === 'idle' && line.productStatus !== 'available' && (
                  <StatusBadge status={line.productStatus} />
                )}
              </span>

              {!compact && (
                <Link
                  href={`/admin/products/${line.productId}`}
                  className="hidden label text-muted hover:text-ink md:block"
                  aria-label={`Edit ${line.productName}`}
                >
                  Edit
                </Link>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
