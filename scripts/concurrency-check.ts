/* ============================================================================
 * The spec's section 39 scenario, exercised through the REAL HTTP API rather
 * than by calling library functions.
 *
 * Two independent visitors (separate cookie jars, so separate carts) POST to
 * /api/cart for the last remaining unit at the same moment. Exactly one must
 * get 200; the other must get 409 with a message a customer can understand.
 *
 *     npx tsx scripts/concurrency-check.ts
 * ========================================================================== */

import './load-env'

import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import { inventory, productVariants, products } from '../src/db/schema'

const BASE = process.env.CHECK_BASE ?? 'http://localhost:3100'

/* One "browser": its own cookie jar, kept across requests. */
function makeVisitor(name: string) {
  let cookie = ''
  return {
    name,
    async post(path: string, body: unknown) {
      const res = await fetch(BASE + path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      })
      const setCookie = res.headers.getSetCookie?.() ?? []
      if (setCookie.length) {
        cookie = setCookie.map((c) => c.split(';')[0]).join('; ')
      }
      const json = (await res.json().catch(() => null)) as Record<string, unknown> | null
      return { status: res.status, body: json }
    },
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

async function stockOf(variantId: string) {
  const [row] = await db
    .select({
      onHand: inventory.onHand,
      reserved: inventory.reserved,
      available: sql<number>`${inventory.onHand} - ${inventory.reserved}`.mapWith(Number),
    })
    .from(inventory)
    .where(eq(inventory.variantId, variantId))
  return row
}

async function main() {
  console.log(`\nChecking ${BASE} — the last-item race, over HTTP\n`)

  /* Pick a real variant from the seeded catalogue and set it to exactly one. */
  const [variant] = await db
    .select({
      id: productVariants.id,
      sku: productVariants.sku,
      size: productVariants.size,
      slug: products.slug,
    })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(products.slug, 'whey-protein-isolate'))
    .limit(1)

  if (!variant) throw new Error('Seed the database first: npm run db:seed')

  await db
    .update(inventory)
    .set({ onHand: 1, reserved: 0 })
    .where(eq(inventory.variantId, variant.id))

  console.log(`  set ${variant.sku} (${variant.size}) to exactly 1 unit\n`)

  /* --- two visitors, one unit, same instant --- */
  const a = makeVisitor('A')
  const b = makeVisitor('B')

  const [resA, resB] = await Promise.all([
    a.post('/api/cart', { variantId: variant.id, quantity: 1 }),
    b.post('/api/cart', { variantId: variant.id, quantity: 1 }),
  ])

  const winners = [resA, resB].filter((r) => r.status === 200)
  const losers = [resA, resB].filter((r) => r.status === 409)

  check('exactly one visitor got 200', winners.length === 1, { A: resA.status, B: resB.status })
  check('exactly one visitor got 409', losers.length === 1, { A: resA.status, B: resB.status })
  check(
    'the loser was told why, in plain language',
    typeof losers[0]?.body?.message === 'string' &&
      /no longer available|out of stock/i.test(String(losers[0]?.body?.message)),
    losers[0]?.body,
  )
  check('the loser was told what is available', losers[0]?.body?.available === 0, losers[0]?.body)

  const after = await stockOf(variant.id)
  check('stock is reserved exactly once', after.reserved === 1, after)
  check('nothing was oversold', after.available === 0, after)
  check('on-hand is untouched until payment', after.onHand === 1, after)

  /* --- ten visitors, one unit --- */
  console.log('\n  ten visitors, one unit\n')
  await db.update(inventory).set({ onHand: 1, reserved: 0 }).where(eq(inventory.variantId, variant.id))

  const crowd = Array.from({ length: 10 }, (_, i) => makeVisitor(`V${i}`))
  const results = await Promise.all(
    crowd.map((v) => v.post('/api/cart', { variantId: variant.id, quantity: 1 })),
  )

  const ok = results.filter((r) => r.status === 200).length
  const conflict = results.filter((r) => r.status === 409).length
  const other = results.filter((r) => r.status !== 200 && r.status !== 409)

  check('exactly one of ten succeeded', ok === 1, { ok, conflict })
  check('the other nine got a clean 409', conflict === 9, { ok, conflict })
  check('nobody got a 500', other.length === 0, other.map((r) => r.status))

  const final = await stockOf(variant.id)
  check('stock still reserved exactly once', final.reserved === 1, final)

  /* --- restore the seeded level so the demo catalogue looks normal --- */
  await db.update(inventory).set({ onHand: 12, reserved: 0 }).where(eq(inventory.variantId, variant.id))
  console.log('\n  restored stock to 12\n')

  if (failures === 0) {
    console.log('✓ the last-item race behaves correctly over HTTP\n')
  } else {
    console.log(`✗ ${failures} check(s) failed\n`)
    process.exitCode = 1
  }
}

main()
  .catch((err) => {
    console.error('✗ check failed to run:', err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
