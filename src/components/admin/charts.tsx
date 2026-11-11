/* ============================================================================
 * Report charts, drawn as SVG on the server (no chart library, no client
 * code). Hovering any bar or point shows its exact value.
 *
 *   ColumnChart    months side by side, one or two series, values on caps
 *   HBarChart      ranked rows (categories), value at the tip
 *   LineChart      a value over months, soft area, labels at the ends
 *   SegmentedBar   one whole split into parts (where the units went)
 *
 * Specs: thin bars (max 24px) with 4px rounded ends, 2px lines, 8px dots
 * with a surface ring, hairline solid gridlines, labels in text colours
 * (never the series colour), a legend whenever there are two series.
 * Colours: single series use the AIONIX gold; several series use CHART_SERIES,
 * checked for colour blind separation on the dark surface.
 * ========================================================================== */

import type { ReactNode } from 'react'

export const GOLD = '#ffd43b'
export const LOSS = '#ff4d3d'
export const CONTEXT = '#5a5a5a'
/** In this order, never cycled: amber, blue, aqua, violet, orange. */
export const CHART_SERIES = ['#c98500', '#3987e5', '#199e70', '#9085e9', '#d95926']
export const REMAINDER = '#3a3a3a'

const INK = '#e6e6e6'
const MUTED = '#a7a7a7'
const GRID = '#2e2e2e'
const SURFACE = '#0b0b0b'

/** €1,234 → "€1.2K", €12 → "€12". Cents in. */
export function compactEur(cents: number) {
  const v = cents / 100
  const a = Math.abs(v)
  const s = a >= 1_000_000 ? `${(a / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M` : a >= 1000 ? `${(a / 1000).toFixed(a >= 10_000 ? 0 : 1)}K` : a >= 100 ? a.toFixed(0) : a.toFixed(a % 1 ? 2 : 0)
  return `${v < 0 ? '−' : ''}€${s.replace('.0K', 'K').replace('.0M', 'M')}`
}

function niceStep(range: number, ticks = 4) {
  const raw = range / ticks || 1
  const p = 10 ** Math.floor(Math.log10(raw))
  const f = raw / p
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p
}

function scale(values: number[]) {
  const max = Math.max(0, ...values)
  const min = Math.min(0, ...values)
  const step = niceStep(max - min || 1)
  const top = Math.ceil(max / step) * step || step
  const bottom = Math.floor(min / step) * step
  const ticks: number[] = []
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(Math.round(v))
  return { top, bottom, ticks }
}

function Legend({ items }: { items: { name: string; color: string }[] }) {
  if (items.length < 2) return null
  return (
    <div className="mb-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-soft">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-2">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  )
}

/** A column with a 4px rounded end away from the baseline, square at it. */
function column(x: number, w: number, y0: number, y1: number) {
  const r = Math.min(4, w / 2, Math.abs(y1 - y0))
  if (y1 <= y0) return `M${x},${y0} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 + r} V${y0} Z`
  return `M${x},${y0} V${y1 - r} Q${x},${y1} ${x + r},${y1} H${x + w - r} Q${x + w},${y1} ${x + w},${y1 - r} V${y0} Z`
}

export type Series = {
  name: string
  color: string
  /** Bars below zero in this colour instead (profit that is a loss). */
  negativeColor?: string
  values: number[]
  /** Value labels on the caps (every bar, or the last one), or under each
   *  month name ('axis'), so two series side by side never collide. */
  labels?: 'all' | 'last' | 'axis' | 'none'
}

export function ColumnChart({ categories, series, format = compactEur, height = 240, caption }: { categories: string[]; series: Series[]; format?: (v: number) => string; height?: number; caption?: ReactNode }) {
  const W = 800
  const axisSeries = series.find((s) => s.labels === 'axis')
  const pad = { l: 56, r: 12, t: 22, b: axisSeries ? 46 : 30 }
  const all = series.flatMap((s) => s.values)
  const { top, bottom, ticks } = scale(all)
  const plotH = height - pad.t - pad.b
  const y = (v: number) => pad.t + ((top - v) / (top - bottom || 1)) * plotH
  const band = (W - pad.l - pad.r) / Math.max(1, categories.length)
  const gap = 2
  const barW = Math.min(24, (band * 0.7 - gap * (series.length - 1)) / series.length)
  const groupW = barW * series.length + gap * (series.length - 1)
  return (
    <figure>
      <Legend items={series} />
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img" aria-label={series.map((s) => s.name).join(' and ')}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? '#4a4a4a' : GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
              {format(t)}
            </text>
          </g>
        ))}
        {categories.map((c, i) => {
          const gx = pad.l + band * i + (band - groupW) / 2
          return (
            <g key={c}>
              {series.map((s, si) => {
                const v = s.values[i] ?? 0
                const x = gx + si * (barW + gap)
                const fill = v < 0 && s.negativeColor ? s.negativeColor : s.color
                const show = s.labels === 'all' || (s.labels === 'last' && i === categories.length - 1)
                return (
                  <g key={s.name}>
                    {v !== 0 && <path d={column(x, barW, y(0), y(v))} fill={fill} />}
                    {/* A taller invisible target, so hovering is easy. */}
                    <rect x={x - 2} y={pad.t} width={barW + 4} height={plotH} fill="transparent">
                      <title>{`${c} · ${s.name}: ${format(v)}`}</title>
                    </rect>
                    {show && v !== 0 && (
                      <text x={x + barW / 2} y={v >= 0 ? y(v) - 6 : y(v) + 14} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK} pointerEvents="none">
                        {format(v)}
                      </text>
                    )}
                  </g>
                )
              })}
              <text x={pad.l + band * i + band / 2} y={height - (axisSeries ? 26 : 10)} textAnchor="middle" fontSize={11} fill={MUTED}>
                {c}
              </text>
              {axisSeries && (
                <text x={pad.l + band * i + band / 2} y={height - 8} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK}>
                  {format(axisSeries.values[i] ?? 0)}
                </text>
              )}
            </g>
          )
        })}
      </svg>
      {caption && <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>}
    </figure>
  )
}

export function HBarChart({ rows, color = GOLD, format = compactEur, caption }: { rows: { label: string; value: number; note?: string }[]; color?: string; format?: (v: number) => string; caption?: ReactNode }) {
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value)))
  return (
    <figure>
      <ul className="space-y-3">
        {rows.map((r) => {
          const pct = (Math.abs(r.value) / max) * 100
          return (
            <li key={r.label} title={`${r.label}: ${format(r.value)}${r.note ? ` · ${r.note}` : ''}`}>
              <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate text-ink">{r.label}</span>
                <span className="shrink-0 text-xs text-muted">{r.note}</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-3.5 flex-1">
                  <div className="h-full rounded-r" style={{ width: `${Math.max(pct, r.value ? 1 : 0)}%`, background: r.value < 0 ? LOSS : color }} />
                </div>
                <span className="w-24 shrink-0 text-right text-sm font-semibold tabular-nums text-heading">{format(r.value)}</span>
              </div>
            </li>
          )
        })}
      </ul>
      {caption && <figcaption className="mt-3 text-xs text-muted">{caption}</figcaption>}
    </figure>
  )
}

export function LineChart({ categories, values, color = GOLD, format = compactEur, height = 220, caption }: { categories: string[]; values: (number | null)[]; color?: string; format?: (v: number) => string; height?: number; caption?: ReactNode }) {
  const W = 800
  const pad = { l: 56, r: 24, t: 26, b: 30 }
  const known = values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null)
  const { top, bottom, ticks } = scale(known.map((p) => p.v))
  const plotH = height - pad.t - pad.b
  const step = (W - pad.l - pad.r) / Math.max(1, categories.length - 1)
  const x = (i: number) => pad.l + step * i
  const y = (v: number) => pad.t + ((top - v) / (top - bottom || 1)) * plotH
  const line = known.map((p, k) => `${k ? 'L' : 'M'}${x(p.i)},${y(p.v)}`).join(' ')
  const area = known.length ? `${line} L${x(known[known.length - 1].i)},${y(Math.max(bottom, 0))} L${x(known[0].i)},${y(Math.max(bottom, 0))} Z` : ''
  const maxP = known.reduce<{ v: number; i: number } | null>((m, p) => (!m || p.v > m.v ? p : m), null)
  const last = known[known.length - 1]
  const labelled = new Set([last?.i, maxP?.i, known[0]?.i])
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${height}`} className="h-auto w-full" role="img">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill={MUTED}>
              {format(t)}
            </text>
          </g>
        ))}
        {area && <path d={area} fill={color} opacity={0.1} />}
        {line && <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        {known.map((p) => (
          <g key={p.i}>
            <circle cx={x(p.i)} cy={y(p.v)} r={4.5} fill={color} stroke={SURFACE} strokeWidth={2} />
            <circle cx={x(p.i)} cy={y(p.v)} r={14} fill="transparent">
              <title>{`${categories[p.i]}: ${format(p.v)}`}</title>
            </circle>
            {labelled.has(p.i) && (
              <text x={x(p.i)} y={y(p.v) - 10} textAnchor="middle" fontSize={11} fontWeight={600} fill={INK} pointerEvents="none">
                {format(p.v)}
              </text>
            )}
          </g>
        ))}
        {categories.map((c, i) => (
          <text key={c} x={x(i)} y={height - 10} textAnchor="middle" fontSize={11} fill={MUTED}>
            {c}
          </text>
        ))}
      </svg>
      {caption && <figcaption className="mt-2 text-xs text-muted">{caption}</figcaption>}
    </figure>
  )
}

/** One whole split into parts, with 2px gaps, labels inside only where they
 *  fit, and a legend with every value underneath. */
export function SegmentedBar({ parts, format = (v: number) => String(v), unit = '' }: { parts: { label: string; value: number; color: string }[]; format?: (v: number) => string; unit?: string }) {
  const shown = parts.filter((p) => p.value > 0)
  const total = shown.reduce((s, p) => s + p.value, 0)
  if (total === 0) return null
  return (
    <figure>
      <div className="flex h-9 w-full gap-[2px] overflow-hidden rounded-md" role="img" aria-label={shown.map((p) => `${p.label} ${format(p.value)}`).join(', ')}>
        {shown.map((p) => {
          const pct = (p.value / total) * 100
          return (
            <div key={p.label} className="flex items-center justify-center" style={{ width: `${pct}%`, background: p.color }} title={`${p.label}: ${format(p.value)}${unit} (${Math.round(pct)}%)`}>
              {pct >= 7 && <span className="text-xs font-semibold text-white">{format(p.value)}</span>}
            </div>
          )
        })}
      </div>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-ink-soft">
        {shown.map((p) => (
          <span key={p.label} className="inline-flex items-center gap-2">
            <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label} <span className="font-semibold tabular-nums text-heading">{format(p.value)}</span>
            <span className="text-muted">{Math.round((p.value / total) * 100)}%</span>
          </span>
        ))}
      </figcaption>
    </figure>
  )
}
