/* ============================================================================
 * Size ordering.
 *
 * Postgres sorts sizes alphabetically, which gives "L, M, One size, S, XL, XS,
 * XXL" — nonsense to a customer standing in front of a size filter. Sizes have
 * a conventional order that no database collation knows about, so the ordering
 * happens here, in one place, and every list of sizes in the UI goes through
 * it: filter facets, the size picker on a product page, the admin stock table.
 *
 * Deliberately free of imports so client components can use it.
 * ========================================================================== */

/* Letter sizes, smallest first. Lower-cased keys; lookup is case-insensitive
   so "xl" and "XL" land in the same slot. */
const LETTER_ORDER = [
  'xxxs',
  'xxs',
  'xs',
  's',
  'xs/s',
  'm',
  's/m',
  'l',
  'm/l',
  'xl',
  'l/xl',
  'xxl',
  '2xl',
  'xxxl',
  '3xl',
  '4xl',
]

const LETTER_RANK = new Map(LETTER_ORDER.map((s, i) => [s, i]))

/* Sizes that mean "fits everyone" belong at the end of the list, after the
   graded ones, however they are spelled. */
const ONE_SIZE = /^(one[\s-]?size|free[\s-]?size|os|osfa|uni)$/i

/** A sortable rank for one size label.
 *
 *  Three bands, so the groups never interleave:
 *    0 — numeric sizes (28, 30, 32 … / EU 38, 40), sorted numerically
 *    1 — letter sizes, in the conventional order above
 *    2 — anything unrecognised, then one-size last of all, alphabetical within
 */
function rank(size: string): [number, number, string] {
  const key = size.trim().toLowerCase()

  if (ONE_SIZE.test(key)) return [3, 0, key]

  const letter = LETTER_RANK.get(key)
  if (letter !== undefined) return [1, letter, key]

  /* Supplement pack sizes: weights ("300g", "1kg", "2.27kg", "5lb"), volumes
     ("500ml", "1l") and counts ("90 caps", "120 tabs", "12 bars"). Weights are
     converted to grams so "300g" sorts before "1kg", and every count sorts in
     its own band so capsules never interleave with powders. */
  const pack =
    /^(\d+(?:[.,]\d+)?)\s*(kg|g|lbs?|ml|l|caps(?:ules)?|tabs|tablets|softgels|servings|bars|pcs|pack)\b/.exec(
      key,
    )
  if (pack) {
    const n = Number(pack[1].replace(',', '.'))
    const unit = pack[2]
    const grams =
      unit === 'kg' ? n * 1000 : unit.startsWith('lb') ? n * 453.6 : unit === 'l' ? n * 1000 : n
    return [0, grams, key]
  }

  /* Leading number: "32", "32R", "38 EU", "10.5". */
  const numeric = /^(\d+(?:[.,]\d+)?)/.exec(key)
  if (numeric) return [0, Number(numeric[1].replace(',', '.')), key]

  return [2, 0, key]
}

/** Compare two size labels in the order a customer expects. */
export function compareSizes(a: string, b: string): number {
  const [ba, ra, ka] = rank(a)
  const [bb, rb, kb] = rank(b)
  if (ba !== bb) return ba - bb
  if (ra !== rb) return ra - rb
  return ka.localeCompare(kb)
}

/** Sort a list of size labels. Returns a new array. */
export function sortSizes(sizes: string[]): string[] {
  return [...sizes].sort(compareSizes)
}

/** Sort any rows carrying a size, without losing the rest of the row. */
export function sortBySize<T>(rows: T[], get: (row: T) => string): T[] {
  return [...rows].sort((a, b) => compareSizes(get(a), get(b)))
}
