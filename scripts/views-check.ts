/* ============================================================================
 * Product views over HTTP — the write side of "Most viewed" and the
 * "Recently viewed" strip.
 *
 *     npx tsx scripts/views-check.ts
 * ========================================================================== */

import './load-env'

import { desc, eq, sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import { productVariants, productViews, products } from '../src/db/schema'

const BASE = process.env.CHECK_BASE ?? 'http://localhost:3100'

/* Minimal JSON typing, so the checks read nested fields without `any`. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

function at(value: Json | undefined, ...path: (string | number)[]): Json | undefined {
  let cursor: Json | undefined = value
  for (const step of path) {
    if (cursor === null || cursor === undefined) return undefined
    if (typeof step === 'number') {
      if (!Array.isArray(cursor)) return undefined
      cursor = cursor[step]
    } else {
      if (typeof cursor !== 'object' || Array.isArray(cursor)) return undefined
      cursor = (cursor as { [key: string]: Json })[step]
    }
  }
  return cursor
}

function num(value: Json | undefined): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function str(value: Json | undefined): string | undefined {
  return typeof value === 'string' ? value : undefined
}

/** The slugs in a recently-viewed response, in order. */
function slugsOf(body: Json | undefined): string[] {
  const items = at(body, 'items')
  if (!Array.isArray(items)) return []
  return items.map((_, i) => str(at(body, 'items', i, 'slug'))).filter((s): s is string => !!s)
}


function makeVisitor() {
  let cookie = ''
  async function call(method: string, path: string, body?: unknown) {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    })
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const pair = c.split(';')[0]
      const name = pair.split('=')[0]
      cookie = cookie
        .split('; ')
        .filter((p) => p && p.split('=')[0] !== name)
        .concat(pair)
        .join('; ')
    }
    const text = await res.text()
    let json: Json | undefined
    try {
      json = text ? (JSON.parse(text) as Json) : undefined
    } catch {
      json = undefined
    }
    return { status: res.status, body: json }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b),
    hasCookie: () => cookie.length > 0,
  }
}

let failures = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) {
    failures++
    if (detail !== undefined) console.log('      ', JSON.stringify(detail))
  }
}

async function viewCount(productId: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(productViews)
    .where(eq(productViews.productId, productId))
  return row?.n ?? 0
}

async function main() {
  console.log(`\nChecking ${BASE} — product views\n`)

  await db.delete(productViews)

  const rows = await db
    .select({ id: products.id, slug: products.slug })
    .from(products)
    .orderBy(desc(products.createdAt))
    .limit(3)
  if (rows.length < 3) throw new Error('Seed the database first: npm run db:seed')

  const [a, b, c] = rows

  /* A visitor with a cart cookie: views are tied to them. */
  const [variant] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .where(eq(productVariants.productId, a.id))
    .limit(1)

  const v = makeVisitor()
  if (variant) await v.post('/api/cart', { variantId: variant.id, quantity: 1 })
  check('the visitor has a cart cookie', v.hasCookie())

  const first = await v.post('/api/products/views', { productId: a.id })
  check('a view is accepted', first.status === 204, first)
  check('it was recorded', (await viewCount(a.id)) === 1)

  /* Refreshing must not inflate the count. */
  await v.post('/api/products/views', { productId: a.id })
  await v.post('/api/products/views', { productId: a.id })
  check('refreshing does not inflate the count', (await viewCount(a.id)) === 1, {
    count: await viewCount(a.id),
  })

  /* A different visitor does. */
  const other = makeVisitor()
  if (variant) await other.post('/api/cart', { variantId: variant.id, quantity: 1 })
  await other.post('/api/products/views', { productId: a.id })
  check('a second visitor counts separately', (await viewCount(a.id)) === 2, {
    count: await viewCount(a.id),
  })

  /* Bad input is refused without touching the table. */
  const bad = await v.post('/api/products/views', { productId: 'not-a-uuid' })
  check('a malformed product id is refused', bad.status === 422, bad)
  const missing = await v.post('/api/products/views', {})
  check('a missing product id is refused', missing.status === 422, missing)

  /* --- recently viewed --- */
  await v.post('/api/products/views', { productId: b.id })
  await v.post('/api/products/views', { productId: c.id })

  const recent = await v.get('/api/products/recently-viewed')
  const slugs = slugsOf(recent.body)
  check('recently viewed comes back newest first', slugs[0] === c.slug && slugs[1] === b.slug, slugs)
  check(
    'it carries a price',
    num(at(recent.body, 'items', 0, 'finalCents')) !== undefined,
    at(recent.body, 'items', 0),
  )

  const excluded = await v.get(`/api/products/recently-viewed?exclude=${c.id}`)
  const exSlugs = slugsOf(excluded.body)
  check('the product being looked at is excluded', !exSlugs.includes(c.slug), exSlugs)

  const stranger = makeVisitor()
  const empty = await stranger.get('/api/products/recently-viewed')
  check('a stranger sees nobody else’s history', slugsOf(empty.body).length === 0, empty.body)

  /* --- the sort that depends on all this --- */
  const listing = await fetch(`${BASE}/en/sports-nutrition?sort=popular`)
  check('the "most viewed" sort renders', listing.status === 200, listing.status)

  if (failures === 0) {
    console.log('\n✓ product views behave correctly over HTTP\n')
  } else {
    console.log(`\n✗ ${failures} check(s) failed\n`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('✗ check failed to run:', err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
