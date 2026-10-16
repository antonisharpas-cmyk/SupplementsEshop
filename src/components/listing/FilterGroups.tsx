'use client'

/* ============================================================================
 * The filter groups — Department, Category, Size, Colour, Price,
 * Availability — as one piece used twice: in the desktop sidebar, where each
 * change applies at once, and in the phone drawer, where changes collect
 * until "Show N results".
 *
 * Every control is the real control for what it does: sizes and colours are
 * toggle buttons (aria-pressed), categories are checkboxes, the department is
 * a radio group, availability are switches, price is a slider with inputs.
 * State is never shown by colour alone: a chosen size inverts, a chosen
 * colour gains a ring AND a tick, a switch moves.
 * ========================================================================== */

import { useId, useState } from 'react'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import type { ProductListing } from '@/lib/catalog'
import { toggle, type ListingFilters } from '@/lib/listing-filters'
import type { ListingScope } from './ListingShell'
import { PriceRange } from './PriceRange'

type Facets = ProductListing['facets']

export const wholeEuros = (locale: Locale) => {
  const nf = new Intl.NumberFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-IE', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  })
  return (n: number) => nf.format(n)
}

/** Price bounds in whole euros, rounded outwards so every product fits. */
export function priceBounds(facets: Facets): [number, number] | null {
  const lo = Math.floor(facets.priceRange.minCents / 100)
  const hi = Math.ceil(facets.priceRange.maxCents / 100)
  return hi > lo ? [lo, hi] : null
}

/* ------------------------------------------------------------ pieces --- */

function Group({
  title,
  summary,
  defaultOpen = true,
  children,
}: {
  title: string
  summary?: string
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  const id = useId()
  return (
    <section className="rounded-2xl border border-line bg-paper-2/50 px-4 transition-colors hover:border-line-strong">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 py-3.5 text-left"
        >
          <span className="font-display text-[13px] font-semibold tracking-[0.06em] text-heading uppercase">{title}</span>
          <span className="flex min-w-0 items-center gap-2">
            {summary && (
              <span className="truncate rounded-full bg-accent/15 px-2.5 py-0.5 text-[11px] font-medium text-accent">{summary}</span>
            )}
            <svg
              aria-hidden
              viewBox="0 0 12 12"
              className={`box-content h-3 w-3 shrink-0 rounded-full bg-paper p-1.5 text-muted transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
            >
              <path d="M2.5 4.5 6 8l3.5-3.5" />
            </svg>
          </span>
        </button>
      </h3>
      {/* Height animates via grid rows (0fr → 1fr): smooth, no measuring.
          Collapsed content is `inert`, so it leaves the tab order too. */}
      <div
        id={id}
        inert={!open}
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="pb-4 pt-0.5">{children}</div>
        </div>
      </div>
    </section>
  )
}

export function Switch({
  label,
  hint,
  on,
  onChange,
}: {
  label: string
  hint?: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  const id = useId()
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl px-1 py-2">
      <span>
        <span id={id} className="block text-sm">
          {label}
        </span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-labelledby={id}
        onClick={() => onChange(!on)}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-paper ${
          on ? 'bg-gold border-transparent shadow-[0_4px_14px_-6px_rgb(242_183_5/0.7)]' : 'border-line-strong bg-paper'
        }`}
      >
        <span
          aria-hidden
          className={`absolute left-[3px] h-[18px] w-[18px] rounded-full shadow transition-transform duration-200 ${
            on ? 'translate-x-[20px] bg-paper' : 'translate-x-0 bg-muted'
          }`}
        />
      </button>
    </div>
  )
}

function Check({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-[18px] w-[18px] shrink-0 place-items-center rounded-md border transition-colors ${on ? 'bg-gold border-transparent' : 'border-line-strong bg-paper'}`}
    >
      {on && (
        <svg viewBox="0 0 12 12" className="h-3 w-3 text-paper" fill="none" stroke="currentColor" strokeWidth="2.2">
          <path d="m2.5 6.2 2.3 2.3 4.7-5" />
        </svg>
      )}
    </span>
  )
}

/** Light swatches get a darker tick and a visible edge. */
function isLight(hex: string | null): boolean {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return true
  const n = parseInt(hex.slice(1), 16)
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
  return 0.299 * r + 0.587 * g + 0.114 * b > 170
}

/* ------------------------------------------------------------ groups --- */

export function FilterGroups({
  locale,
  scope,
  salePage,
  facets,
  value,
  onChange,
}: {
  locale: Locale
  scope: ListingScope
  salePage: boolean
  facets: Facets
  value: ListingFilters
  onChange: (next: ListingFilters) => void
}) {
  const t = getTranslator(locale)
  const money = wholeEuros(locale)
  const [allCategories, setAllCategories] = useState(false)
  const [allColours, setAllColours] = useState(false)
  const set = (patch: Partial<ListingFilters>) => onChange({ ...value, ...patch })

  /* Options that exist on this page. One that would show nothing with the
     other filters as they are is dimmed and disabled, kept in place so the
     panel does not rearrange itself under the shopper, unless it is
     already chosen, so it can always be un-chosen. */
  const sizes = facets.sizes.map((s) => ({ size: s.size, empty: s.count === 0 }))
  for (const s of value.sizes) if (!sizes.some((x) => x.size === s)) sizes.push({ size: s, empty: true })
  const colours = facets.colours
  const COLOUR_PREVIEW = 8
  /* Chosen ones always stay in view, even when the list is folded. */
  const shownColours =
    allColours || colours.length <= COLOUR_PREVIEW + 2
      ? colours
      : colours.filter((c, i) => i < COLOUR_PREVIEW || value.colours.includes(c.value))
  const categories = facets.categories
  const bounds = priceBounds(facets)
  const selectedCount = (n: number) => (n ? t('list.selected', { n }) : undefined)

  const CATEGORY_PREVIEW = 6
  const shownCategories =
    allCategories || categories.length <= CATEGORY_PREVIEW + 2 ? categories : categories.slice(0, CATEGORY_PREVIEW)

  const price: [number, number] | null = bounds
    ? [
        Math.max(bounds[0], Math.min(value.minPrice ?? bounds[0], bounds[1])),
        Math.min(bounds[1], Math.max(value.maxPrice ?? bounds[1], bounds[0])),
      ]
    : null
  const priceActive = value.minPrice !== undefined || value.maxPrice !== undefined

  return (
    <div className="space-y-3">
      {/* Department — only on pages that span departments. */}
      {scope === 'all' && facets.departments.length > 1 && (
        <Group
          title={t('list.department')}
          summary={facets.departments.find((d) => d.value === value.department)?.label}
        >
          <div role="radiogroup" aria-label={t('list.department')} className="space-y-0.5">
            {[
              { value: '', label: t('list.allDepartments'), count: undefined as number | undefined },
              ...facets.departments,
            ].map((d) => {
              const on = (value.department ?? '') === d.value
              return (
                <button
                  key={d.value || 'all'}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={d.count === 0 && !on}
                  onClick={() =>
                    set({
                      department: d.value || undefined,
                      /* Categories from the other department no longer apply. */
                      categories: d.value
                        ? value.categories.filter((c) => c.startsWith(`${d.value}/`))
                        : value.categories,
                    })
                  }
                  className={`flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left text-sm transition-colors disabled:text-line-strong ${on ? 'bg-accent/10 text-heading' : 'hover:bg-paper'}`}
                >
                  <span
                    aria-hidden
                    className={`grid h-[18px] w-[18px] place-items-center rounded-full border transition-colors ${on ? 'border-accent' : 'border-line-strong'}`}
                  >
                    {on && <span className="bg-gold h-2.5 w-2.5 rounded-full" />}
                  </span>
                  <span className={on ? 'font-medium' : ''}>{d.label}</span>
                  {d.count !== undefined && <span className="ml-auto rounded-full bg-paper px-2 py-0.5 text-[11px] tabular-nums text-muted">{d.count}</span>}
                </button>
              )
            })}
          </div>
        </Group>
      )}

      {/* Category — subcategories of this department, or of every department. */}
      {scope !== 'subcategory' && categories.length > 1 && (
        <Group title={t('list.category')} summary={selectedCount(value.categories.length)}>
          <ul className="space-y-0.5">
            {shownCategories.map((c, i) => {
              const on = value.categories.includes(c.value)
              const header = c.group && c.group !== shownCategories[i - 1]?.group ? c.group : null
              return (
                <li key={c.value}>
                  {header && (
                    <p className="px-2.5 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-muted first:pt-0">{header}</p>
                  )}
                  <label
                    className={`flex items-center gap-3 rounded-xl px-2.5 py-2 text-sm transition-colors ${c.count === 0 && !on ? 'text-line-strong' : 'cursor-pointer hover:bg-paper'} ${on ? 'bg-accent/10 text-heading' : ''}`}
                  >
                    <input
                      type="checkbox"
                      className="peer sr-only"
                      disabled={c.count === 0 && !on}
                      checked={on}
                      onChange={() => set({ categories: toggle(value.categories, c.value) })}
                    />
                    <Check on={on} />
                    <span className={`peer-focus-visible:underline ${on ? 'font-medium' : ''}`}>{c.label}</span>
                    <span className="ml-auto rounded-full bg-paper px-2 py-0.5 text-[11px] tabular-nums text-muted">{c.count}</span>
                  </label>
                </li>
              )
            })}
          </ul>
          {categories.length > shownCategories.length || allCategories ? (
            <button
              type="button"
              onClick={() => setAllCategories((v) => !v)}
              className="btn btn-ghost btn-sm mt-2"
            >
              {allCategories ? t('list.showFewer') : t('list.showAll', { n: categories.length })}
            </button>
          ) : null}
        </Group>
      )}

      {/* Size */}
      {sizes.length > 0 && (
        <Group title={t('list.size')} summary={value.sizes.length ? value.sizes.join(', ') : undefined}>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('list.size')}>
            {sizes.map(({ size, empty }) => {
              const on = value.sizes.includes(size)
              return (
                <button
                  key={size}
                  type="button"
                  aria-pressed={on}
                  disabled={empty && !on}
                  onClick={() => set({ sizes: toggle(value.sizes, size) })}
                  className={`h-9 min-w-12 rounded-full border px-4 text-[13px] font-medium transition-all duration-150 ${
                    on
                      ? 'bg-gold border-transparent text-paper shadow-[0_6px_18px_-10px_rgb(242_183_5/0.8)]'
                      : 'border-line bg-paper text-ink hover:border-accent hover:text-accent disabled:cursor-default disabled:border-line disabled:text-line-strong disabled:line-through'
                  }`}
                >
                  {size}
                </button>
              )
            })}
          </div>
        </Group>
      )}

      {/* Colour */}
      {colours.length > 1 && (
        <Group
          title={t('list.colour')}
          summary={
            value.colours.length
              ? value.colours.map((k) => colours.find((c) => c.value === k)?.label ?? k).join(', ')
              : undefined
          }
        >
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('list.colour')}>
            {shownColours.map((c) => {
              const on = value.colours.includes(c.value)
              const light = isLight(c.hex)
              return (
                <button
                  key={c.value}
                  type="button"
                  aria-pressed={on}
                  title={c.label}
                  disabled={c.count === 0 && !on}
                  onClick={() => set({ colours: toggle(value.colours, c.value) })}
                  className={`group inline-flex h-9 max-w-full items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-[13px] transition-all duration-150 focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-default disabled:opacity-30 ${
                    on
                      ? 'border-accent bg-accent/10 font-medium text-heading shadow-[0_6px_18px_-12px_rgb(242_183_5/0.9)]'
                      : 'border-line bg-paper text-ink-soft hover:border-line-strong hover:text-ink'
                  }`}
                >
                  <span
                    className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${light ? 'shadow-[inset_0_0_0_1px_var(--color-line-strong)]' : ''}`}
                    style={{ background: c.hex ?? 'repeating-linear-gradient(45deg,#ddd 0 3px,#fff 3px 6px)' }}
                  >
                    {on && (
                      <svg
                        viewBox="0 0 12 12"
                        aria-hidden
                        className={`h-3 w-3 ${light ? 'text-black' : 'text-white'}`}
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <path d="m2.5 6.2 2.3 2.3 4.7-5" />
                      </svg>
                    )}
                  </span>
                  <span className="truncate">{c.label}</span>
                </button>
              )
            })}
          </div>
          {colours.length > shownColours.length || allColours ? (
            <button type="button" onClick={() => setAllColours((v) => !v)} className="btn btn-ghost btn-sm mt-3">
              {allColours ? t('list.showFewer') : t('list.showAll', { n: colours.length })}
            </button>
          ) : null}
        </Group>
      )}

      {/* Price */}
      {bounds && price && (
        <Group title={t('list.price')} summary={priceActive ? `${money(price[0])} – ${money(price[1])}` : undefined}>
          <PriceRange
            lo={bounds[0]}
            hi={bounds[1]}
            value={price}
            format={money}
            labels={{
              min: t('list.sliderMin'),
              max: t('list.sliderMax'),
              minimum: t('list.minimum'),
              maximum: t('list.maximum'),
              outOfRange: t('list.priceOutOfRange', { min: '{min}', max: '{max}' }),
            }}
            onCommit={([min, max]) =>
              set({
                /* Back at an end means no limit on that side. */
                minPrice: min > bounds[0] ? min : undefined,
                maxPrice: max < bounds[1] ? max : undefined,
              })
            }
          />
        </Group>
      )}

      {/* Availability */}
      <Group
        title={t('list.availability')}
        summary={selectedCount((value.inStock ? 1 : 0) + (value.onSale && !salePage ? 1 : 0))}
      >
        <Switch
          label={t('list.inStock')}
          hint={t('list.inStockHint')}
          on={value.inStock}
          onChange={(on) => set({ inStock: on })}
        />
        {!salePage && (
          <Switch
            label={t('list.onSale')}
            hint={t('list.onSaleHint')}
            on={value.onSale}
            onChange={(on) => set({ onSale: on })}
          />
        )}
      </Group>
    </div>
  )
}

/* ---------------------------------------------------- active filters --- */

export type ActiveChip = { key: string; label: string; without: ListingFilters }

/** Every active filter as a removable chip, in the order of the groups. */
export function activeChips(f: ListingFilters, facets: Facets, locale: Locale, salePage: boolean): ActiveChip[] {
  const t = getTranslator(locale)
  const money = wholeEuros(locale)
  const out: ActiveChip[] = []
  if (f.department) {
    out.push({
      key: `d:${f.department}`,
      label: facets.departments.find((d) => d.value === f.department)?.label ?? f.department,
      without: { ...f, department: undefined },
    })
  }
  for (const c of f.categories) {
    out.push({
      key: `c:${c}`,
      label: facets.categories.find((x) => x.value === c)?.label ?? c.split('/').pop()!,
      without: { ...f, categories: f.categories.filter((x) => x !== c) },
    })
  }
  for (const s of f.sizes)
    out.push({ key: `s:${s}`, label: s, without: { ...f, sizes: f.sizes.filter((x) => x !== s) } })
  for (const c of f.colours) {
    out.push({
      key: `k:${c}`,
      label:
        facets.colours.find((x) => x.value === c)?.label ??
        c.replace(/-/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase()),
      without: { ...f, colours: f.colours.filter((x) => x !== c) },
    })
  }
  if (f.minPrice !== undefined || f.maxPrice !== undefined) {
    const label =
      f.minPrice !== undefined && f.maxPrice !== undefined
        ? `${money(f.minPrice)} – ${money(f.maxPrice)}`
        : f.minPrice !== undefined
          ? t('list.minPrice', { price: money(f.minPrice) })
          : t('list.maxPrice', { price: money(f.maxPrice!) })
    out.push({ key: 'price', label, without: { ...f, minPrice: undefined, maxPrice: undefined } })
  }
  if (f.inStock) out.push({ key: 'stock', label: t('list.inStock'), without: { ...f, inStock: false } })
  if (f.onSale && !salePage) out.push({ key: 'sale', label: t('list.onSale'), without: { ...f, onSale: false } })
  return out
}
