'use client'

/* ============================================================================
 * Price: a two-handle range slider with typed inputs beneath.
 *
 *   drag either handle · tap the track (the nearer handle jumps there)
 *   ← → ±€1 · Shift/PageUp/PageDown ±€10 · Home/End to the ends
 *   type an amount — it applies when you pause, press Enter or leave the box
 *
 * Bounds are the cheapest and dearest price in this listing, in whole euros
 * (rounded outwards, so every product sits inside them). The handles cannot
 * cross; typed values are held to the bounds and to each other. Moving both
 * handles back to the ends removes the price filter altogether.
 *
 * `onCommit` fires when a drag ends or a typed value settles — never on
 * every pixel — so one drag is one request, not two hundred.
 *
 * On a phone the handles have 44-pixel touch targets and the track claims
 * the gesture (touch-action: none) so dragging never scrolls the page.
 * ========================================================================== */

import { useEffect, useId, useRef, useState } from 'react'

type Props = {
  lo: number
  hi: number
  /** The current selection, whole euros. */
  value: [number, number]
  onCommit: (value: [number, number]) => void
  format: (euros: number) => string
  labels: { min: string; max: string; minimum: string; maximum: string; outOfRange: string }
}

const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n))

export function PriceRange({ lo, hi, value, onCommit, format, labels }: Props) {
  const id = useId()
  const [range, setRange] = useState<[number, number]>(value)
  const [dragging, setDragging] = useState<0 | 1 | null>(null)
  const track = useRef<HTMLDivElement>(null)
  const rangeRef = useRef(range)
  const span = Math.max(1, hi - lo)

  /* A new selection from outside — a chip removed, "clear all", the back
     button, replaces what the handles show (unless one is being dragged).
     Adjusting state while rendering, as React recommends, not in an effect. */
  const [seen, setSeen] = useState(value)
  if ((seen[0] !== value[0] || seen[1] !== value[1]) && dragging === null) {
    setSeen(value)
    setRange(value)
  }

  useEffect(() => {
    rangeRef.current = range
  }, [range])

  const pct = (n: number) => ((n - lo) / span) * 100

  function valueAt(clientX: number): number {
    const rect = track.current!.getBoundingClientRect()
    const ratio = clamp((clientX - rect.left) / rect.width, 0, 1)
    return Math.round(lo + ratio * span)
  }

  function set(handle: 0 | 1, n: number): [number, number] {
    const [a, b] = rangeRef.current
    const next: [number, number] = handle === 0 ? [clamp(n, lo, b), b] : [a, clamp(n, a, hi)]
    rangeRef.current = next
    setRange(next)
    return next
  }

  /* ------------------------------------------------------------ pointer -- */

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    const n = valueAt(e.clientX)
    const [a, b] = rangeRef.current
    /* The nearer handle; when they sit together, the side you pressed on. */
    const handle: 0 | 1 =
      a === b ? (n < a ? 0 : n > b ? 1 : b >= hi ? 0 : 1) : Math.abs(n - a) <= Math.abs(n - b) ? 0 : 1
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(handle)
    set(handle, n)
    document.getElementById(`${id}-${handle}`)?.focus({ preventScroll: true })
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (dragging === null) return
    set(dragging, valueAt(e.clientX))
  }

  function onPointerUp() {
    if (dragging === null) return
    setDragging(null)
    onCommit(rangeRef.current)
  }

  /* ----------------------------------------------------------- keyboard -- */

  function onKeyDown(handle: 0 | 1, e: React.KeyboardEvent) {
    const current = rangeRef.current[handle]
    const big = 10
    let next: number | null = null
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = current - (e.shiftKey ? big : 1)
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = current + (e.shiftKey ? big : 1)
    else if (e.key === 'PageDown') next = current - big
    else if (e.key === 'PageUp') next = current + big
    else if (e.key === 'Home') next = lo
    else if (e.key === 'End') next = hi
    if (next === null) return
    e.preventDefault()
    set(handle, next)
  }

  /* Keyboard changes apply shortly after the last key press. */
  const keyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function onKeyUp(e: React.KeyboardEvent) {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End'].includes(e.key))
      return
    if (keyTimer.current) clearTimeout(keyTimer.current)
    keyTimer.current = setTimeout(() => onCommit(rangeRef.current), 450)
  }
  useEffect(
    () => () => {
      if (keyTimer.current) clearTimeout(keyTimer.current)
    },
    [],
  )

  const [a, b] = range

  return (
    <div>
      <p className="mb-1 flex items-center justify-between gap-2 text-sm font-semibold tabular-nums text-heading" aria-hidden>
        <span className="rounded-full bg-paper px-3 py-1">{format(a)}</span>
        <span className="h-px flex-1 bg-line-strong" />
        <span className="rounded-full bg-paper px-3 py-1">{format(b)}</span>
      </p>

      {/* The track: tall enough to hit, thin enough to look like a line. */}
      <div
        ref={track}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className="relative mx-2.5 h-11 cursor-pointer touch-none select-none"
      >
        <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-line" />
        <div
          className="bg-gold absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full"
          style={{ left: `${pct(a)}%`, right: `${100 - pct(b)}%` }}
        />
        {([0, 1] as const).map((handle) => {
          const v = range[handle]
          return (
            <div
              key={handle}
              id={`${id}-${handle}`}
              role="slider"
              tabIndex={0}
              aria-label={handle === 0 ? labels.min : labels.max}
              aria-valuemin={handle === 0 ? lo : a}
              aria-valuemax={handle === 0 ? b : hi}
              aria-valuenow={v}
              aria-valuetext={format(v)}
              onKeyDown={(e) => onKeyDown(handle, e)}
              onKeyUp={onKeyUp}
              onBlur={() => {
                if (keyTimer.current) {
                  clearTimeout(keyTimer.current)
                  keyTimer.current = null
                  onCommit(rangeRef.current)
                }
              }}
              /* Later handle on top, except when both are at the far right
                 and only the lower one can still move. */
              style={{ left: `${pct(v)}%`, zIndex: handle === 0 && a === b && b >= hi ? 3 : handle + 1 }}
              className="group absolute top-1/2 grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 place-items-center outline-none"
            >
              <span
                className={`block h-5 w-5 rounded-full border-[3px] border-accent bg-paper shadow-[0_4px_12px_-4px_rgb(242_183_5/0.8)] transition-transform duration-150 group-hover:scale-110 group-focus-visible:ring-2 group-focus-visible:ring-accent group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-paper ${
                  dragging === handle ? 'scale-110' : ''
                }`}
              />
            </div>
          )
        })}
      </div>

      <PriceInputs
        lo={lo}
        hi={hi}
        value={range}
        onCommit={(next) => {
          rangeRef.current = next
          setRange(next)
          onCommit(next)
        }}
        format={format}
        labels={labels}
      />
    </div>
  )
}

function PriceInputs({
  lo,
  hi,
  value,
  onCommit,
  format,
  labels,
}: {
  lo: number
  hi: number
  value: [number, number]
  onCommit: (v: [number, number]) => void
  format: (n: number) => string
  labels: Props['labels']
}) {
  const [text, setText] = useState<[string, string]>([String(value[0]), String(value[1])])
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  /* Follow the handles live — except while someone is typing here. */
  const [seen, setSeen] = useState(value)
  if (seen[0] !== value[0] || seen[1] !== value[1]) {
    setSeen(value)
    if (!editing) setText([String(value[0]), String(value[1])])
  }
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorId = useId()

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  /** Read both boxes, hold them to the bounds and to each other, apply. */
  function settle(t: [string, string], final: boolean) {
    const parse = (s: string) => {
      const n = Number(s.replace(',', '.').replace(/[^\d.]/g, ''))
      return s.trim() === '' || !Number.isFinite(n) ? null : n
    }
    const pa = parse(t[0])
    const pb = parse(t[1])
    if (pa === null || pb === null) {
      if (final) {
        setText([String(value[0]), String(value[1])])
        setError(null)
      }
      return
    }
    const outside = pa < lo || pb > hi || pa > hi || pb < lo
    if (outside && !final) {
      setError(labels.outOfRange.replace('{min}', format(lo)).replace('{max}', format(hi)))
      return
    }
    let min = clamp(Math.floor(pa), lo, hi)
    let max = clamp(Math.ceil(pb), lo, hi)
    if (min > max) [min, max] = [max, min]
    setError(null)
    if (final) setText([String(min), String(max)])
    if (min !== value[0] || max !== value[1]) onCommit([min, max])
  }

  function onChange(i: 0 | 1, s: string) {
    const next: [string, string] = i === 0 ? [s, text[1]] : [text[0], s]
    setText(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => settle(next, false), 700)
  }

  function finish() {
    if (timer.current) clearTimeout(timer.current)
    settle(text, true)
  }

  const box = (i: 0 | 1, label: string) => (
    <label className="block">
      <span className="mb-1.5 block text-[11px] text-muted">{label}</span>
      <span className="flex items-center rounded-xl border border-line bg-paper px-3 transition-colors focus-within:border-accent">
        <span aria-hidden className="text-sm text-muted">
          €
        </span>
        <input
          inputMode="numeric"
          autoComplete="off"
          value={text[i]}
          aria-label={i === 0 ? labels.min : labels.max}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => onChange(i, e.target.value)}
          onFocus={() => setEditing(true)}
          onBlur={() => {
            setEditing(false)
            finish()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              finish()
            }
          }}
          className="h-10 w-full min-w-0 bg-transparent pl-1.5 text-sm tabular-nums outline-none"
        />
      </span>
    </label>
  )

  return (
    <div className="mt-3">
      <div className="grid grid-cols-2 gap-3">
        {box(0, labels.minimum)}
        {box(1, labels.maximum)}
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-2 text-xs text-sale">
          {error}
        </p>
      )}
    </div>
  )
}
