'use client'

/* ============================================================================
 * The product page photos.
 *
 *   One large photo with arrows, and the rest as thumbnails under it.
 *   Choosing a flavour (or a size) on the right shows that flavour's photos:
 *   the chosen size's own photos first, then the flavour's other sizes, then
 *   the photos meant for the whole product. A flavour with no photos of its
 *   own shows the whole product's photos.
 *
 *   Clicking the photo opens it full screen: arrows (or the keyboard's left
 *   and right keys, or a swipe), zoom in and out (buttons, + and -, or a
 *   click on the photo; the zoomed photo follows the pointer), Esc closes.
 * ========================================================================== */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { VARIANT_EVENT, flavourKey, type VariantChoice } from '@/lib/variant-events'

type Photo = { url: string; alt: string; variantId: string | null }
type Variant = { id: string; colorName: Record<string, string> | null; colorHex: string | null }

const ZOOMS = [1, 2, 3]

function Arrow({ dir, onClick, big }: { dir: 'prev' | 'next'; onClick: () => void; big?: boolean }) {
  return (
    <button
      type="button"
      aria-label={dir === 'prev' ? 'Previous photo' : 'Next photo'}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute top-1/2 z-10 grid -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/55 text-white backdrop-blur-sm transition hover:border-accent hover:text-accent ${
        big ? 'h-12 w-12' : 'h-10 w-10 opacity-0 group-hover:opacity-100 focus:opacity-100 max-lg:opacity-100'
      } ${dir === 'prev' ? 'left-3' : 'right-3'}`}
    >
      <svg aria-hidden viewBox="0 0 20 20" className="h-5 w-5" fill="currentColor">
        {dir === 'prev' ? (
          <path d="M12.7 5.3a1 1 0 0 1 0 1.4L9.4 10l3.3 3.3a1 1 0 1 1-1.4 1.4l-4-4a1 1 0 0 1 0-1.4l4-4a1 1 0 0 1 1.4 0z" />
        ) : (
          <path d="M7.3 5.3a1 1 0 0 1 1.4 0l4 4a1 1 0 0 1 0 1.4l-4 4a1 1 0 0 1-1.4-1.4l3.3-3.3-3.3-3.3a1 1 0 0 1 0-1.4z" />
        )}
      </svg>
    </button>
  )
}

export function ProductGallery({ photos, variants, name }: { photos: Photo[]; variants: Variant[]; name: string }) {
  const keyOf = useMemo(() => new Map(variants.map((v) => [v.id, flavourKey(v)])), [variants])
  const [choice, setChoice] = useState<VariantChoice>(() => ({ flavour: variants[0] ? flavourKey(variants[0]) : '', variantId: null }))

  useEffect(() => {
    const on = (e: Event) => setChoice((e as CustomEvent<VariantChoice>).detail)
    window.addEventListener(VARIANT_EVENT, on)
    return () => window.removeEventListener(VARIANT_EVENT, on)
  }, [])

  /* The photos for what is chosen now. */
  const shown = useMemo(() => {
    const general = photos.filter((p) => !p.variantId || !keyOf.has(p.variantId))
    const own = photos.filter((p) => p.variantId && p.variantId === choice.variantId)
    const flavour = photos.filter((p) => p.variantId && p.variantId !== choice.variantId && keyOf.get(p.variantId) === choice.flavour)
    const mine = [...own, ...flavour]
    if (mine.length === 0) return general.length ? general : photos
    return [...mine, ...general]
  }, [photos, keyOf, choice])

  /* A new flavour starts at its first photo. */
  const choiceKey = `${choice.flavour}|${choice.variantId ?? ''}`
  const [active, setActive] = useState<{ key: string; url: string | null }>({ key: '', url: null })
  const activeUrl = active.key === choiceKey ? active.url : null
  const setActiveUrl = useCallback((url: string | null) => setActive({ key: choiceKey, url }), [choiceKey])
  const index = Math.max(0, shown.findIndex((p) => p.url === activeUrl))
  const current = shown[index]
  const go = useCallback((step: number) => setActiveUrl(shown[(index + step + shown.length) % shown.length]?.url ?? null), [shown, index, setActiveUrl])

  const [open, setOpen] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [origin, setOrigin] = useState('50% 50%')
  const swipeFrom = useRef<number | null>(null)
  /* A swipe is not also a click. */
  const swiped = useRef(false)

  const close = useCallback(() => {
    setOpen(false)
    setZoom(1)
  }, [])
  const step = useCallback(
    (n: number) => {
      setZoom(1)
      go(n)
    },
    [go],
  )

  /* Keyboard and no page scroll while full screen. */
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close()
      else if (e.key === 'ArrowLeft') step(-1)
      else if (e.key === 'ArrowRight') step(1)
      else if (e.key === '+' || e.key === '=') setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])
      else if (e.key === '-') setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])
    }
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = before
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close, step])

  if (!current) {
    return <div className="label grid aspect-square place-items-center bg-paper-2 text-muted">No image</div>
  }
  const many = shown.length > 1
  const follow = (e: React.PointerEvent<HTMLElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setOrigin(`${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}% ${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`)
  }

  return (
    <div>
      {/* the large photo */}
      <div className="group relative aspect-square overflow-hidden bg-paper-2">
        <button
          type="button"
          onClick={() => {
            if (swiped.current) swiped.current = false
            else setOpen(true)
          }}
          aria-label={`${name}: open the photo full screen`}
          className="block h-full w-full cursor-zoom-in"
          onPointerDown={(e) => (swipeFrom.current = e.clientX)}
          onPointerUp={(e) => {
            const from = swipeFrom.current
            swipeFrom.current = null
            if (from !== null && Math.abs(e.clientX - from) > 50 && e.pointerType !== 'mouse') {
              swiped.current = true
              go(e.clientX < from ? 1 : -1)
            }
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={current.url} alt={current.alt} className="h-full w-full object-contain p-4 transition-transform duration-500 group-hover:scale-[1.03]" draggable={false} />
        </button>
        {many && (
          <>
            <Arrow dir="prev" onClick={() => go(-1)} />
            <Arrow dir="next" onClick={() => go(1)} />
            <span className="label absolute right-3 bottom-3 rounded-full bg-black/55 px-2.5 py-1 text-[11px] text-white tabular-nums">
              {index + 1} / {shown.length}
            </span>
          </>
        )}
        <span aria-hidden className="absolute top-3 right-3 grid h-9 w-9 place-items-center rounded-full bg-black/55 text-white opacity-0 transition group-hover:opacity-100">
          <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="8.5" cy="8.5" r="5.5" />
            <path d="M12.5 12.5 17 17M8.5 6v5M6 8.5h5" />
          </svg>
        </span>
      </div>

      {/* thumbnails */}
      {many && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
          {shown.map((p, i) => (
            <button
              key={p.url}
              type="button"
              onClick={() => setActiveUrl(p.url)}
              aria-label={`Photo ${i + 1}`}
              aria-current={i === index}
              className={`h-20 w-20 shrink-0 overflow-hidden border bg-paper-2 transition-colors ${i === index ? 'border-accent' : 'border-line hover:border-line-strong'}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="" loading="lazy" className="h-full w-full object-contain p-1" />
            </button>
          ))}
        </div>
      )}

      {/* full screen */}
      {open && (
        <div role="dialog" aria-modal="true" aria-label={name} className="fixed inset-0 z-[100] flex flex-col bg-black" onClick={close}>
          <div className="flex items-center justify-between gap-3 px-4 py-3 text-white" onClick={(e) => e.stopPropagation()}>
            <span className="label text-white/70 tabular-nums">
              {index + 1} / {shown.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Zoom out"
                disabled={zoom === ZOOMS[0]}
                onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)])}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-xl hover:border-accent hover:text-accent disabled:opacity-30"
              >
                −
              </button>
              <span className="w-12 text-center text-sm text-white/70 tabular-nums">{zoom * 100}%</span>
              <button
                type="button"
                aria-label="Zoom in"
                disabled={zoom === ZOOMS[ZOOMS.length - 1]}
                onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)])}
                className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-xl hover:border-accent hover:text-accent disabled:opacity-30"
              >
                +
              </button>
              <button type="button" aria-label="Close" onClick={close} className="ml-2 grid h-10 w-10 place-items-center rounded-full border border-white/15 hover:border-accent hover:text-accent">
                <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M5 5l10 10M15 5 5 15" />
                </svg>
              </button>
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden px-2" onClick={(e) => e.stopPropagation()}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={current.url}
              alt={current.alt}
              draggable={false}
              onClick={(e) => {
                if (swiped.current) {
                  swiped.current = false
                  return
                }
                follow(e as unknown as React.PointerEvent<HTMLElement>)
                setZoom((z) => (z === 1 ? 2 : 1))
              }}
              onPointerMove={(e) => zoom > 1 && follow(e)}
              onPointerDown={(e) => (swipeFrom.current = e.clientX)}
              onPointerUp={(e) => {
                const from = swipeFrom.current
                swipeFrom.current = null
                if (zoom === 1 && from !== null && Math.abs(e.clientX - from) > 50) {
                  swiped.current = true
                  step(e.clientX < from ? 1 : -1)
                }
              }}
              style={{ transform: `scale(${zoom})`, transformOrigin: origin, touchAction: zoom > 1 ? 'none' : 'pan-y' }}
              className={`max-h-full max-w-full select-none object-contain transition-transform duration-200 ${zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'}`}
            />
            {many && (
              <>
                <Arrow dir="prev" big onClick={() => step(-1)} />
                <Arrow dir="next" big onClick={() => step(1)} />
              </>
            )}
          </div>

          {many && (
            <div className="flex justify-center gap-2 overflow-x-auto px-4 py-3" onClick={(e) => e.stopPropagation()}>
              {shown.map((p, i) => (
                <button
                  key={p.url}
                  type="button"
                  onClick={() => {
                    setZoom(1)
                    setActiveUrl(p.url)
                  }}
                  aria-label={`Photo ${i + 1}`}
                  className={`h-14 w-14 shrink-0 overflow-hidden border ${i === index ? 'border-accent' : 'border-white/15'}`}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" loading="lazy" className="h-full w-full object-contain" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
