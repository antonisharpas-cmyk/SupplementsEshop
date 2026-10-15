/* ============================================================================
 * Promo codes over the real HTTP API — spec sections 11 and 20.
 *
 * Checks the whole loop a customer goes through: apply, see it in the totals,
 * survive a page refresh, be refused for a good reason, remove it. And the one
 * that matters most: a code cannot be talked into a discount by the client.
 *
 *     npx tsx scripts/promo-check.ts
 * ========================================================================== */

import './load-env'

import { eq } from 'drizzle-orm'
import { db, pool } from '../src/db'
import { inventory, productVariants, products } from '../src/db/schema'

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
      const kept = cookie
        .split('; ')
        .filter((p) => p && p.split('=')[0] !== name)
        .concat(pair)
      cookie = kept.join('; ')
    }
    const json = (await res.json().catch(() => null)) as Json | null
    return { status: res.status, body: json ?? undefined }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b),
    del: (p: string) => call('DELETE', p),
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

async function main() {
  console.log(`\nChecking ${BASE} — promo codes\n`)

  const [variant] = await db
    .select({ id: productVariants.id, sku: productVariants.sku })
    .from(productVariants)
    .innerJoin(products, eq(productVariants.productId, products.id))
    .where(eq(products.slug, 'whey-protein-isolate'))
    .limit(1)
  if (!variant) throw new Error('Seed the database first: npm run db:seed')

  await db.update(inventory).set({ onHand: 12, reserved: 0 }).where(eq(inventory.variantId, variant.id))

  const v = makeVisitor()

  /* A code with an empty bag has nothing to discount. */
  const tooEarly = await v.post('/api/cart/promo', { code: 'WELCOME10' })
  check('a promo code on an empty bag is refused', tooEarly.status === 409, tooEarly)

  const added = await v.post('/api/cart', { variantId: variant.id, quantity: 1 })
  check('added the whey', added.status === 200, added)

  const before = num(at(added.body, 'totals', 'subtotalCents')) ?? 0
  check('the bag has a subtotal', before > 0, at(added.body, 'totals'))

  /* --- a code that applies --- */
  const applied = await v.post('/api/cart/promo', { code: 'WELCOME10' })
  check('WELCOME10 is accepted', applied.status === 200, applied)
  check('it returns a real discount', (num(at(applied.body, 'discountCents')) ?? 0) > 0, applied.body)
  check(
    'the discount is 10% of the discounted subtotal',
    num(at(applied.body, 'discountCents')) === Math.round(before * 0.1),
    { got: at(applied.body, 'discountCents'), expected: Math.round(before * 0.1) },
  )

  /* --- it survives a refresh, because it lives on the cart row --- */
  const reread = await v.get('/api/cart')
  check(
    'the code is still applied after a fresh request',
    str(at(reread.body, 'totals', 'promoCode', 'code')) === 'WELCOME10',
    at(reread.body, 'totals', 'promoCode'),
  )
  check(
    'the reread discount matches',
    num(at(reread.body, 'totals', 'promoCodeDiscountCents')) ===
      num(at(applied.body, 'discountCents')),
    { reread: at(reread.body, 'totals', 'promoCodeDiscountCents') },
  )
  check(
    'delivery is never discounted by a promo code',
    (num(at(reread.body, 'totals', 'promoCodeDiscountCents')) ?? 0) <=
      (num(at(reread.body, 'totals', 'subtotalCents')) ?? 0),
    at(reread.body, 'totals'),
  )

  /* --- refusals say why --- */
  const expired = await v.post('/api/cart/promo', { code: 'EXPIRED20' })
  check('an expired code is refused', expired.status === 409, expired)
  check(
    'the refusal explains itself',
    /expired/i.test(String(str(at(expired.body, 'message')))),
    expired.body,
  )
  check(
    'a refusal does not replace the working code',
    str(at((await v.get('/api/cart')).body, 'totals', 'promoCode', 'code')) === 'WELCOME10',
  )

  const nonsense = await v.post('/api/cart/promo', { code: 'NOTACODE' })
  check('an unknown code is refused', nonsense.status === 409, nonsense)

  const injection = await v.post('/api/cart/promo', { code: "' OR 1=1 --" })
  check('a code that is not a code is rejected before any query', injection.status === 422, injection)

  /* --- the client cannot dictate the discount --- */
  const forged = await v.post('/api/cart/promo', {
    code: 'WELCOME10',
    discountCents: 9_999_999,
    totals: { promoCodeDiscountCents: 9_999_999 },
  })
  check('extra fields in the body are ignored', forged.status === 200, forged)
  check(
    'the server recomputed the discount rather than trusting the body',
    num(at(forged.body, 'discountCents')) === Math.round(before * 0.1),
    forged.body,
  )

  /* --- removing it --- */
  const removed = await v.del('/api/cart/promo')
  check('the code can be removed', removed.status === 200, removed)
  const after = await v.get('/api/cart')
  check(
    'the discount is gone',
    (num(at(after.body, 'totals', 'promoCodeDiscountCents')) ?? 0) === 0,
    at(after.body, 'totals'),
  )
  check(
    'the bag itself is untouched',
    num(at(after.body, 'totals', 'subtotalCents')) === before,
    at(after.body, 'totals'),
  )

  /* --- and the cart page renders the applied state --- */
  await v.post('/api/cart/promo', { code: 'WELCOME10' })
  const page = await fetch(`${BASE}/en/cart`, {
    headers: { Cookie: (await v.get('/api/cart'), '') },
  })
  check('the cart page still renders', page.status === 200, page.status)

  /* tidy up */
  await v.del('/api/cart')

  if (failures === 0) {
    console.log('\n✓ promo codes behave correctly over HTTP\n')
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
