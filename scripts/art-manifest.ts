/* ============================================================================
 * Which pack each product comes in, and in what colour.
 *
 * Shared by the artwork generator and the seed, so the two cannot drift: if a
 * product is listed here it gets artwork, and the seed looks for exactly the
 * file the generator wrote.
 * ========================================================================== */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { PackKind, PackLabel } from './supplement-art'

/** A real photograph in any of these formats beats the drawn artwork. */
export const PHOTO_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp', '.avif']

export function artDir() {
  return join(process.cwd(), 'public', 'products')
}

export function heroDir() {
  return join(process.cwd(), 'public', 'hero')
}

/** The first of these that exists in `dir`, as a public URL under `base`. */
function firstPhoto(dir: string, base: string, name: string): string | null {
  for (const ext of PHOTO_EXTENSIONS) {
    /* Ignore comments: the folder is only known at run time, and without them
       the production build would bundle the whole project to be safe. */
    if (existsSync(/*turbopackIgnore: true*/ join(/*turbopackIgnore: true*/ dir, `${name}${ext}`)))
      return `${base}/${name}${ext}`
  }
  return null
}

export type ArtItem = {
  slug: string
  kind: PackKind
  label: PackLabel
  /** [flavour colour, a deeper tone of it] */
  colors: [string, string]
}

export const CATALOGUE_ART: ArtItem[] = [
  { slug: 'whey-protein-isolate', kind: 'tub', label: { title: ['Whey', 'Isolate'], sub: 'Chocolate', size: '2KG' }, colors: ['#6b4129', '#3d2416'] },
  { slug: 'whey-protein-100', kind: 'pouch', label: { title: ['100%', 'Whey'], sub: 'Cookies & Cream', size: '2.27KG' }, colors: ['#d9d4cc', '#a9a39a'] },
  { slug: 'vegan-protein-blend', kind: 'pouch', label: { title: ['Vegan', 'Protein'], sub: 'Chocolate', size: '1KG' }, colors: ['#5b8f3a', '#36581f'] },
  { slug: 'creatine-monohydrate', kind: 'jar', label: { title: ['Creatine'], sub: 'Monohydrate', size: '500G' }, colors: ['#c9c9c9', '#8a8a8a'] },
  { slug: 'creatine-hcl-capsules', kind: 'bottle', label: { title: ['Creatine', 'HCL'], sub: 'Capsules', size: '120 CAPS' }, colors: ['#9aa7b5', '#5f6b78'] },
  { slug: 'pre-workout-ignite', kind: 'jar', label: { title: ['Ignite'], sub: 'Blue Raspberry', size: '300G' }, colors: ['#2f7de1', '#1a4f94'] },
  { slug: 'stim-free-pump', kind: 'jar', label: { title: ['Pump'], sub: 'Stim Free', size: '360G' }, colors: ['#ef5a6f', '#a3283a'] },
  { slug: 'bcaa-2-1-1', kind: 'jar', label: { title: ['BCAA'], sub: '2:1:1 Tropical', size: '400G' }, colors: ['#f2a33a', '#b4691a'] },
  { slug: 'l-glutamine', kind: 'jar', label: { title: ['L Glutamine'], sub: 'Unflavoured', size: '500G' }, colors: ['#bfc6cc', '#7f878e'] },
  { slug: 'mass-gainer', kind: 'pouch', label: { title: ['Mass', 'Gainer'], sub: 'Vanilla', size: '3KG' }, colors: ['#efe2b5', '#c4b27a'] },
  { slug: 'daily-multivitamin', kind: 'bottle', label: { title: ['Multi', 'Vitamin'], sub: 'Daily', size: '90 TABS' }, colors: ['#f08a24', '#a95a0f'] },
  { slug: 'vitamin-d3-k2', kind: 'bottle', label: { title: ['D3 + K2'], sub: 'Vitamins', size: '60 CAPS' }, colors: ['#ffd23f', '#c79a00'] },
  { slug: 'omega-3-fish-oil', kind: 'bottle', label: { title: ['Omega 3'], sub: 'Fish Oil', size: '120 SOFTGELS' }, colors: ['#3fb6c9', '#1d7684'] },
  { slug: 'l-carnitine-capsules', kind: 'bottle', label: { title: ['L Carnitine'], sub: 'Capsules', size: '90 CAPS' }, colors: ['#e5e5e5', '#9a9a9a'] },
  { slug: 'protein-bar-box', kind: 'bar', label: { title: ['Protein', 'Bar'], sub: 'Chocolate Peanut', size: 'BOX OF 12' }, colors: ['#7b4a2a', '#4b2a15'] },
  { slug: 'aionix-shaker', kind: 'shaker', label: { title: ['Shaker'], sub: 'Supplement Store', size: '700ML' }, colors: ['#FFE600', '#c9b400'] },
]

/** The tiles on the homepage: one representative pack per category. */
export const CATEGORY_TILES: { key: string; kind: PackKind; label: PackLabel; colors: [string, string] }[] = [
  { key: 'sports-nutrition-protein', kind: 'tub', label: { title: ['Protein'], sub: 'Whey', size: '' }, colors: ['#6b4129', '#3d2416'] },
  { key: 'sports-nutrition-creatine', kind: 'jar', label: { title: ['Creatine'], sub: 'Monohydrate' }, colors: ['#c9c9c9', '#8a8a8a'] },
  { key: 'sports-nutrition-pre-workout', kind: 'jar', label: { title: ['Pre', 'Workout'], sub: 'Energy' }, colors: ['#2f7de1', '#1a4f94'] },
  { key: 'sports-nutrition-amino-acids', kind: 'jar', label: { title: ['Amino'], sub: 'BCAA' }, colors: ['#f2a33a', '#b4691a'] },
  { key: 'sports-nutrition-mass-gainers', kind: 'pouch', label: { title: ['Mass', 'Gainer'], sub: 'Bulk' }, colors: ['#efe2b5', '#c4b27a'] },
  { key: 'health-wellness-vitamins', kind: 'bottle', label: { title: ['Vitamins'], sub: 'Daily' }, colors: ['#f08a24', '#a95a0f'] },
  { key: 'health-wellness-omega-3', kind: 'bottle', label: { title: ['Omega 3'], sub: 'Fish Oil' }, colors: ['#3fb6c9', '#1d7684'] },
  { key: 'health-wellness-weight-management', kind: 'bottle', label: { title: ['Lean'], sub: 'Carnitine' }, colors: ['#e5e5e5', '#9a9a9a'] },
  { key: 'health-wellness-bars-snacks', kind: 'bar', label: { title: ['Protein', 'Bar'], sub: 'Snacks' }, colors: ['#7b4a2a', '#4b2a15'] },
  { key: 'health-wellness-accessories', kind: 'shaker', label: { title: ['Shaker'], sub: 'Accessories' }, colors: ['#FFE600', '#c9b400'] },
]

/**
 * The public URL for a product's image: the photograph if the shop has
 * supplied one, otherwise the drawn artwork.
 */
export function artUrl(slug: string, back = false): string {
  const dir = artDir()
  if (!back) {
    return firstPhoto(dir, '/products', slug) ?? `/products/${slug}.svg`
  }
  /* No second photograph? Show the one there is rather than a drawing that
     does not match it. */
  return (
    firstPhoto(dir, '/products', `${slug}-back`) ??
    firstPhoto(dir, '/products', slug) ??
    `/products/${slug}-back.svg`
  )
}

/**
 * The homepage tile for a category, e.g. `sports-nutrition-protein`. Same rule
 * as products: drop `public/products/category-sports-nutrition-protein.jpg` in
 * and it wins.
 */
export function categoryArtUrl(key: string): string {
  return firstPhoto(artDir(), '/products', `category-${key}`) ?? `/products/category-${key}.svg`
}

/**
 * The hero banner. `public/hero/hero.jpg` (wide) and `public/hero/hero-mobile.jpg`
 * (tall) replace the generated gradient. Returns null when neither exists, so
 * the seed can fall back to the gradient it draws itself.
 */
export function heroArtUrl(which: 'hero' | 'hero-mobile'): string | null {
  return (
    firstPhoto(heroDir(), '/hero', which) ??
    (existsSync(join(heroDir(), `${which}.svg`)) ? `/hero/${which}.svg` : null)
  )
}

/** The hero loop, when `public/hero/hero.mp4` (and optionally
 *  `hero-mobile.mp4`) exist. Null means the hero is a still image. */
export function heroVideoUrl(which: 'hero' | 'hero-mobile'): string | null {
  for (const ext of ['.mp4', '.webm']) {
    if (existsSync(join(heroDir(), `${which}${ext}`))) return `/hero/${which}${ext}`
  }
  return null
}
