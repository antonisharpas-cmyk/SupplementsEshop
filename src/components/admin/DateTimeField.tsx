'use client'

/* A date (and optionally a time) picker in the shop's own style, in place of
   the browser's grey calendar. A month grid with the chosen day in gold, the
   time as hour and minute pills, Today and Clear.

   The value is the same string a native box uses, so it drops in anywhere:
     date      "2026-10-16"
     datetime  "2026-10-16T18:30"
   With `name`, a hidden input carries the value for plain HTML forms. */

import { useEffect, useId, useRef, useState } from 'react'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const p2 = (n: number) => String(n).padStart(2, '0')

function parse(v: string): { y: number; m: number; d: number; hh: number; mm: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(v)
  if (!m) return null
  return { y: +m[1], m: +m[2] - 1, d: +m[3], hh: m[4] ? +m[4] : 0, mm: m[5] ? +m[5] : 0 }
}

export function DateTimeField({
  value,
  onChange,
  mode = 'datetime',
  name,
  placeholder,
  min,
  ariaLabel,
  className = '',
  clearable = true,
}: {
  value: string
  onChange?: (v: string) => void
  mode?: 'date' | 'datetime'
  /** False for a date that must always be set (an invoice date). */
  clearable?: boolean
  name?: string
  placeholder?: string
  /** Earliest allowed, same format as value. */
  min?: string
  ariaLabel?: string
  className?: string
}) {
  /* Works controlled (onChange) or on its own inside a GET form. */
  const [own, setOwn] = useState(value)
  const v = onChange ? value : own
  const set = (next: string) => (onChange ? onChange(next) : setOwn(next))

  const [open, setOpen] = useState(false)
  /* Opens to the left when there is no room on the right. */
  const [flip, setFlip] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()
  const cur = parse(v)
  const now = new Date()
  const [view, setView] = useState(() => ({ y: cur?.y ?? now.getFullYear(), m: cur?.m ?? now.getMonth() }))

  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const minP = min ? parse(min) : null
  const minDay = minP ? minP.y * 10000 + minP.m * 100 + minP.d : -1
  const make = (y: number, m: number, d: number, hh: number, mm: number) =>
    mode === 'date' ? `${y}-${p2(m + 1)}-${p2(d)}` : `${y}-${p2(m + 1)}-${p2(d)}T${p2(hh)}:${p2(mm)}`

  const pickDay = (d: number) => {
    set(make(view.y, view.m, d, cur?.hh ?? 10, cur?.mm ?? 0))
    if (mode === 'date') setOpen(false)
  }
  const pickTime = (hh: number, mm: number) => {
    const base = cur ?? { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() }
    set(make(base.y, base.m, base.d, hh, mm))
  }

  const first = (new Date(view.y, view.m, 1).getDay() + 6) % 7
  const days = new Date(view.y, view.m + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)]
  const shift = (k: number) => setView(({ y, m }) => ({ y: m + k < 0 ? y - 1 : m + k > 11 ? y + 1 : y, m: (m + k + 12) % 12 }))

  const shown = cur
    ? `${p2(cur.d)} ${MONTHS[cur.m].slice(0, 3)} ${cur.y}${mode === 'datetime' ? `, ${p2(cur.hh)}:${p2(cur.mm)}` : ''}`
    : null

  return (
    <div ref={box} className={`relative ${className}`}>
      {name && <input type="hidden" name={name} value={v} />}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => {
          if (!open && cur) setView({ y: cur.y, m: cur.m })
          if (!open && box.current) {
            const r = box.current.getBoundingClientRect()
            setFlip(r.left + (mode === 'datetime' ? 480 : 288) > window.innerWidth - 16)
          }
          setOpen((o) => !o)
        }}
        className={`flex w-full items-center gap-2.5 rounded-xl border bg-paper px-3.5 py-2.5 text-left text-sm transition-colors ${open ? 'border-accent' : 'border-line hover:border-line-strong'}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
        <span className={`flex-1 truncate tabular-nums ${shown ? 'text-ink' : 'text-muted'}`}>{shown ?? placeholder ?? 'Choose a date'}</span>
        {shown && clearable && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation()
              set('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                set('')
              }
            }}
            className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-line hover:text-ink"
          >
            ×
          </span>
        )}
      </button>

      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Choose a date"
          className={`absolute top-full z-50 mt-2 rounded-2xl ${flip ? 'right-0' : 'left-0'} border border-line bg-paper p-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)] ${mode === 'datetime' ? 'w-[min(92vw,30rem)]' : 'w-72'}`}
        >
          <div className={mode === 'datetime' ? 'grid gap-4 sm:grid-cols-[1fr_9.5rem]' : ''}>
            <div>
              <div className="mb-3 flex items-center justify-between">
                <button type="button" onClick={() => shift(-1)} aria-label="Previous month" className="grid h-8 w-8 place-items-center rounded-full hover:bg-paper-2">
                  ‹
                </button>
                <p className="font-display text-sm font-semibold text-heading">
                  {MONTHS[view.m]} {view.y}
                </p>
                <button type="button" onClick={() => shift(1)} aria-label="Next month" className="grid h-8 w-8 place-items-center rounded-full hover:bg-paper-2">
                  ›
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 text-center">
                {DAYS.map((d) => (
                  <span key={d} className="pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted">
                    {d}
                  </span>
                ))}
                {cells.map((d, i) => {
                  if (d === null) return <span key={`x${i}`} />
                  const on = cur && cur.y === view.y && cur.m === view.m && cur.d === d
                  const today = now.getFullYear() === view.y && now.getMonth() === view.m && now.getDate() === d
                  const blocked = view.y * 10000 + view.m * 100 + d < minDay
                  return (
                    <button
                      key={d}
                      type="button"
                      disabled={blocked}
                      onClick={() => pickDay(d)}
                      aria-pressed={!!on}
                      className={`grid h-8 place-items-center rounded-full text-[13px] tabular-nums transition-colors disabled:text-line-strong ${
                        on ? 'bg-gold font-semibold text-paper' : today ? 'border border-accent/60 text-accent hover:bg-paper-2' : 'text-ink hover:bg-paper-2'
                      }`}
                    >
                      {d}
                    </button>
                  )
                })}
              </div>
            </div>

            {mode === 'datetime' && (
              <div className="border-t border-line pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-4">
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted">Time</p>
                <div className="flex gap-2">
                  <select
                    aria-label="Hour"
                    value={cur?.hh ?? 10}
                    onChange={(e) => pickTime(+e.target.value, cur?.mm ?? 0)}
                    className="w-full rounded-xl border border-line bg-paper-2 px-2 py-2 text-center text-sm tabular-nums outline-none focus:border-accent"
                  >
                    {Array.from({ length: 24 }, (_, h) => (
                      <option key={h} value={h}>
                        {p2(h)}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Minute"
                    value={cur ? cur.mm - (cur.mm % 5) : 0}
                    onChange={(e) => pickTime(cur?.hh ?? 10, +e.target.value)}
                    className="w-full rounded-xl border border-line bg-paper-2 px-2 py-2 text-center text-sm tabular-nums outline-none focus:border-accent"
                  >
                    {Array.from({ length: 12 }, (_, i) => i * 5).map((m) => (
                      <option key={m} value={m}>
                        {p2(m)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {[
                    [9, 0],
                    [12, 0],
                    [18, 0],
                    [23, 55],
                  ].map(([h, m]) => (
                    <button
                      key={`${h}${m}`}
                      type="button"
                      onClick={() => pickTime(h, m)}
                      className={`rounded-full border px-2.5 py-1 text-xs tabular-nums transition-colors ${
                        cur && cur.hh === h && cur.mm === m ? 'bg-gold border-transparent text-paper' : 'border-line hover:border-accent'
                      }`}
                    >
                      {p2(h)}:{p2(m)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const n = new Date()
                set(make(n.getFullYear(), n.getMonth(), n.getDate(), n.getHours(), n.getMinutes() - (n.getMinutes() % 5)))
                setView({ y: n.getFullYear(), m: n.getMonth() })
              }}
            >
              {mode === 'datetime' ? 'Now' : 'Today'}
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


/* ------------------------------------------------------------- month -- */

const p2m = (n: number) => String(n).padStart(2, '0')

/** A month (YYYY-MM) in the same style: the year with arrows, twelve months. */
export function MonthField({
  value,
  onChange,
  placeholder = 'Choose a month',
  ariaLabel,
  className = '',
  clearable = false,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
  ariaLabel?: string
  className?: string
  clearable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [flip, setFlip] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const id = useId()
  const m = /^(\d{4})-(\d{2})$/.exec(value)
  const cur = m ? { y: +m[1], m: +m[2] - 1 } : null
  const [year, setYear] = useState(() => cur?.y ?? new Date().getFullYear())

  useEffect(() => {
    if (!open) return
    const out = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false)
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', out)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('mousedown', out)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const thisMonth = () => {
    const n = new Date()
    return { y: n.getFullYear(), m: n.getMonth() }
  }

  return (
    <div ref={box} className={`relative ${className}`}>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={id}
        aria-label={ariaLabel}
        onClick={() => {
          if (!open) setYear(cur?.y ?? thisMonth().y)
          if (!open && box.current) setFlip(box.current.getBoundingClientRect().left + 288 > window.innerWidth - 16)
          setOpen((o) => !o)
        }}
        className={`flex w-full items-center gap-2.5 rounded-xl border bg-paper px-3.5 py-2.5 text-left text-sm transition-colors ${open ? 'border-accent' : 'border-line hover:border-line-strong'}`}
      >
        <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-accent" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
        <span className={`flex-1 truncate ${cur ? 'text-ink' : 'text-muted'}`}>{cur ? `${MONTHS[cur.m]} ${cur.y}` : placeholder}</span>
        {cur && clearable && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear"
            onClick={(e) => {
              e.stopPropagation()
              onChange('')
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                onChange('')
              }
            }}
            className="grid h-5 w-5 place-items-center rounded-full text-muted hover:bg-line hover:text-ink"
          >
            ×
          </span>
        )}
      </button>
      {open && (
        <div
          id={id}
          role="dialog"
          aria-label="Choose a month"
          className={`absolute top-full z-50 mt-2 w-72 rounded-2xl ${flip ? 'right-0' : 'left-0'} border border-line bg-paper p-4 shadow-[0_24px_60px_-20px_rgb(0_0_0/0.9)]`}
        >
          <div className="mb-3 flex items-center justify-between">
            <button type="button" onClick={() => setYear((y) => y - 1)} aria-label="Previous year" className="grid h-8 w-8 place-items-center rounded-full hover:bg-paper-2">
              ‹
            </button>
            <p className="font-display text-sm font-semibold text-heading">{year}</p>
            <button type="button" onClick={() => setYear((y) => y + 1)} aria-label="Next year" className="grid h-8 w-8 place-items-center rounded-full hover:bg-paper-2">
              ›
            </button>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {MONTHS.map((name, i) => {
              const on = cur && cur.y === year && cur.m === i
              const now = thisMonth()
              const current = now.y === year && now.m === i
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={!!on}
                  onClick={() => {
                    onChange(`${year}-${p2m(i + 1)}`)
                    setOpen(false)
                  }}
                  className={`h-9 rounded-full text-[13px] transition-colors ${on ? 'bg-gold font-semibold text-paper' : current ? 'border border-accent/60 text-accent hover:bg-paper-2' : 'text-ink hover:bg-paper-2'}`}
                >
                  {name.slice(0, 3)}
                </button>
              )
            })}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-line pt-3">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const n = thisMonth()
                onChange(`${n.y}-${p2m(n.m + 1)}`)
                setOpen(false)
              }}
            >
              This month
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
