/* Which page numbers to show under a long list: the first three, the last
   three, and the ones either side of the current page, with a gap (null)
   where pages are skipped. 10 pages on page 1: 1 2 3 … 8 9 10. On page 5:
   1 2 3 4 5 6 … 8 9 10. */
export function pageNumbers(page: number, pages: number): (number | null)[] {
  if (pages <= 9) return Array.from({ length: pages }, (_, i) => i + 1)
  const keep = new Set<number>()
  for (const p of [1, 2, 3, pages - 2, pages - 1, pages, page - 1, page, page + 1]) if (p >= 1 && p <= pages) keep.add(p)
  const sorted = [...keep].sort((a, b) => a - b)
  const out: (number | null)[] = []
  sorted.forEach((p, i) => {
    if (i > 0 && p !== sorted[i - 1] + 1) out.push(null)
    out.push(p)
  })
  return out
}
