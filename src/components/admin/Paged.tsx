'use client'

/* ============================================================================
 * Long lists in the admin, 15 at a time.
 *
 *   <Paged>{rows}</Paged>             any list of items (cards, list rows)
 *   <PagedTable head={…}>{rows}</PagedTable>   used by the shared Table
 *
 * The rows are rendered on the server as usual; this only shows one page of
 * them and the page buttons under the list. Lists of 15 or fewer show no
 * buttons at all. A list that is already split into pages by the server
 * (orders, customers, products, stock) uses the server's own buttons.
 * ========================================================================== */

import { Children, useState, type ReactNode } from 'react'
import { pageNumbers } from '@/lib/pages'

export const ADMIN_PAGE_SIZE = 15

function usePage(total: number, size: number) {
  const pages = Math.max(1, Math.ceil(total / size))
  const [raw, setPage] = useState(1)
  /* A list that got shorter (a filter, a delete) never shows an empty page. */
  const page = Math.min(raw, pages)
  return { page, pages, setPage }
}

export function PageButtons({
  page,
  pages,
  total,
  size,
  onPage,
}: {
  page: number
  pages: number
  total: number
  size: number
  onPage: (p: number) => void
}) {
  if (pages <= 1) return null
  const from = (page - 1) * size + 1
  const to = Math.min(total, page * size)
  const cls = 'grid h-9 min-w-9 place-items-center rounded-lg border px-2 text-sm tabular-nums transition-colors'
  return (
    <nav aria-label="Pages" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-muted tabular-nums">
        {from} to {to} of {total}
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" className={`${cls} border-line hover:border-accent disabled:opacity-40`} disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          ‹
        </button>
        {pageNumbers(page, pages).map((p, i) =>
          p === null ? (
            <span key={`gap${i}`} className="px-1 text-muted">
              …
            </span>
          ) : (
            <button
              key={p}
              type="button"
              aria-current={p === page ? 'page' : undefined}
              onClick={() => onPage(p)}
              className={`${cls} ${p === page ? 'border-accent bg-accent font-semibold text-black' : 'border-line hover:border-accent'}`}
            >
              {p}
            </button>
          ),
        )}
        <button type="button" className={`${cls} border-line hover:border-accent disabled:opacity-40`} disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page">
          ›
        </button>
      </div>
    </nav>
  )
}

/** Any list: shows 15 of its children at a time. `as` is the element that
 *  holds them (a div by default, or ul for list items). */
export function Paged({
  children,
  size = ADMIN_PAGE_SIZE,
  as: Tag = 'div',
  className,
}: {
  children: ReactNode
  size?: number
  as?: 'div' | 'ul' | 'ol'
  className?: string
}) {
  const items = Children.toArray(children)
  const { page, pages, setPage } = usePage(items.length, size)
  return (
    <>
      <Tag className={className}>{items.slice((page - 1) * size, page * size)}</Tag>
      <PageButtons page={page} pages={pages} total={items.length} size={size} onPage={setPage} />
    </>
  )
}

/** The shared admin table, 15 rows at a time. */
export function PagedTable({
  head,
  children,
  rightFrom,
  size = ADMIN_PAGE_SIZE,
}: {
  head: string[]
  children: ReactNode
  rightFrom?: number
  size?: number
}) {
  const rows = Children.toArray(children)
  const { page, pages, setPage } = usePage(rows.length, size)
  return (
    <>
      <div className="overflow-x-auto rounded-2xl border border-line bg-paper">
        <table className="w-full min-w-[46rem] text-sm">
          <thead>
            <tr className="border-b border-line">
              {head.map((h, i) => (
                <th key={h} className={`label px-4 py-3 text-muted ${rightFrom !== undefined && i >= rightFrom ? 'text-right' : 'text-left'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--color-line)]">{rows.slice((page - 1) * size, page * size)}</tbody>
        </table>
      </div>
      <PageButtons page={page} pages={pages} total={rows.length} size={size} onPage={setPage} />
    </>
  )
}
