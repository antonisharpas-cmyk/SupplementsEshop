/* ============================================================================
 * The admin panel, over real HTTP — spec section 40 (roles) and 41 (admin).
 *
 *     npm run check:admin      (needs the dev server: npm run dev)
 *
 * This is the check that matters most, because everything else in the shop is
 * a feature and this is a door. It proves, against a running server rather
 * than against my reading of the code:
 *
 *   · a signed-out visitor cannot see an admin page, and is sent to sign in;
 *   · a signed-in CUSTOMER gets 404 from every admin page and every admin API,
 *     the same answer a stranger gets, so the panel does not announce itself;
 *   · a customer's write attempts change nothing in the database;
 *   · an admin can actually get in and make the three kinds of change;
 *   · stock cannot be set below what live carts are holding;
 *   · a settings change reaches the storefront immediately.
 *
 * It creates its own two accounts and puts every value it touched back.
 * ========================================================================== */

import './load-env'

import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import {
  homepageSectionItems,
  homepageSections,
  inventory,
  productImages,
  productVariants,
  products,
  users,
} from '../src/db/schema'
import { hashPassword } from '../src/lib/auth/password'
import { getSettings, setSetting, SETTING_DEFAULTS } from '../src/lib/settings'

const BASE = process.env.CHECK_BASE ?? 'http://localhost:3100'
const PASSWORD = 'Check-Admin-Pass-92!'

const PAGES = [
  '/admin',
  '/admin/homepage',
  '/admin/products',
  '/admin/stock',
  '/admin/support',
  '/admin/emails',
  '/admin/emails/campaigns',
  '/admin/emails/subscribers',
  '/admin/emails/activity',
  '/admin/settings',
]

/* ------------------------------------------------------------- plumbing -- */

type Reply = { status: number; location: string | null; text: string; json: unknown }

function visitor() {
  let cookie = ''
  async function call(method: string, path: string, body?: unknown): Promise<Reply> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      /* Manual, always. Following a redirect turns a rejection into a 200 and
         makes a broken guard look like a working one — which is exactly the
         mistake this script exists to stop me repeating. */
      redirect: 'manual',
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
    let parsed: unknown
    try {
      parsed = text ? JSON.parse(text) : undefined
    } catch {
      parsed = undefined
    }
    return { status: res.status, location: res.headers.get('location'), text, json: parsed }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b),
    patch: (p: string, b?: unknown) => call('PATCH', p, b),
    put: (p: string, b?: unknown) => call('PUT', p, b),
    signedIn: () => /sf_session=[^;]/.test(cookie),
  }
}

let failures = 0
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`  ${ok ? '✓' : '✗'} ${label}`)
  if (!ok) {
    failures++
    if (detail !== undefined) console.log('       ', JSON.stringify(detail)?.slice(0, 400))
  }
}
const head = (s: string) => console.log(`\n${s}`)

const message = (r: Reply) =>
  typeof r.json === 'object' && r.json !== null && 'message' in r.json
    ? String((r.json as { message?: unknown }).message)
    : undefined

/* ----------------------------------------------------------------- main -- */

async function main() {
  const stamp = Date.now()
  const adminEmail = `check-admin-${stamp}@example.com`
  const customerEmail = `check-customer-${stamp}@example.com`

  /* Reachability first, with a clear instruction rather than a stack trace. */
  try {
    await fetch(BASE + '/en', { redirect: 'manual' })
  } catch {
    console.error(`\n✗ nothing is answering on ${BASE}.\n  Start the site first:  npm run dev -- -p 3100\n`)
    process.exitCode = 1
    return
  }

  const hash = await hashPassword(PASSWORD)
  await db.insert(users).values([
    {
      email: adminEmail,
      phone: `+3579${String(stamp).slice(-7)}`,
      passwordHash: hash,
      firstName: 'Check',
      lastName: 'Admin',
      role: 'ADMIN',
      emailVerifiedAt: new Date(),
    },
    {
      email: customerEmail,
      phone: `+3578${String(stamp).slice(-7)}`,
      passwordHash: hash,
      firstName: 'Check',
      lastName: 'Customer',
      role: 'CUSTOMER',
      emailVerifiedAt: new Date(),
    },
  ])

  /* A variant with stock, and its product, to experiment on. */
  const [target] = await db
    .select({
      variantId: productVariants.id,
      productId: productVariants.productId,
      onHand: inventory.onHand,
      reserved: inventory.reserved,
      priceCents: products.priceCents,
      salePriceCents: products.salePriceCents,
      slug: products.slug,
    })
    .from(productVariants)
    .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
    .innerJoin(products, eq(products.id, productVariants.productId))
    .where(sql`${inventory.onHand} - ${inventory.reserved} >= 3 and ${products.isActive} and ${products.availability} = 'AVAILABLE'`)
    .limit(1)

  if (!target) {
    console.error('\n✗ no variant with at least 3 available — run npm run db:seed first.\n')
    await db.delete(users).where(sql`${users.email} in (${adminEmail}, ${customerEmail})`)
    process.exitCode = 1
    return
  }

  const settingsBefore = await getSettings(
    Object.keys(SETTING_DEFAULTS) as (keyof typeof SETTING_DEFAULTS)[],
  )

  const stranger = visitor()
  const customer = visitor()
  const admin = visitor()

  /* ------------------------------------------------- signed out: pages -- */

  head('A stranger')
  for (const p of PAGES) {
    const r = await stranger.get(p)
    check(
      `${p} is not served — sent to sign in`,
      r.status === 307 && (r.location ?? '').startsWith('/en/sign-in'),
      { status: r.status, location: r.location },
    )
  }
  for (const p of PAGES) {
    const r = await stranger.get(p)
    check(`${p} leaks nothing of the page itself`, !r.text.includes('Good to see you') && !r.text.includes('Customer Service</h1>'), r.text.slice(0, 120))
  }

  head('A stranger calling the admin API directly')
  const strangerWrites: [string, Reply][] = [
    ['POST /api/admin/stock', await stranger.post('/api/admin/stock', { variantId: target.variantId, onHand: 999 })],
    [
      `PATCH /api/admin/products/:id`,
      await stranger.patch(`/api/admin/products/${target.productId}`, {
        priceCents: 100,
        salePriceCents: null,
        isActive: true,
      }),
    ],
    ['PATCH /api/admin/settings', await stranger.patch('/api/admin/settings', { ...settingsBefore })],
    ['GET /api/admin/support', await stranger.get('/api/admin/support')],
    ['POST /api/admin/newsletter/campaigns', await stranger.post('/api/admin/newsletter/campaigns', { kind: 'promotion', subject: 'x', message: 'xxxxxxxxxxxx', confirmCount: 1 })],
    ['POST /api/admin/newsletter/test', await stranger.post('/api/admin/newsletter/test', { kind: 'promotion', subject: 'xxx', message: 'xxxxxxxxxxxx' })],
  ]
  for (const [label, r] of strangerWrites) {
    check(`${label} → 404, not 401 (the endpoint does not admit it exists)`, r.status === 404, r.status)
  }

  /* --------------------------------------------------- customer: pages -- */

  head('A signed-in customer')
  const custLogin = await customer.post('/api/auth/login', { email: customerEmail, password: PASSWORD })
  check('signs in normally', custLogin.status === 200 && customer.signedIn(), custLogin.status)

  const account = await customer.get('/en/account')
  check('can reach their own account page', account.status === 200, account.status)

  for (const p of PAGES) {
    const r = await customer.get(p)
    check(`${p} → 404 (not a redirect, not "forbidden")`, r.status === 404, {
      status: r.status,
      location: r.location,
    })
  }

  const custStock = await customer.post('/api/admin/stock', {
    variantId: target.variantId,
    onHand: 4242,
  })
  const custProduct = await customer.patch(`/api/admin/products/${target.productId}`, {
    priceCents: 1,
    salePriceCents: null,
    isActive: false,
  })
  const custSettings = await customer.patch('/api/admin/settings', {
    ...settingsBefore,
    max_qty_per_line: 999,
  })
  check('cannot write stock (404)', custStock.status === 404, custStock.status)
  check('cannot write a price (404)', custProduct.status === 404, custProduct.status)
  check('cannot write settings (404)', custSettings.status === 404, custSettings.status)
  const custStatus = await customer.patch(`/api/admin/products/${target.productId}`, { status: 'hidden' })
  const custInbox = await customer.get('/api/admin/support')
  const custSend = await customer.post('/api/admin/newsletter/campaigns', { kind: 'promotion', subject: 'Hello', message: 'Hello everyone!!', confirmCount: 1 })
  check('cannot hide a product, read the inbox or send a mailing (404 ×3)', [custStatus, custInbox, custSend].every((r) => r.status === 404), [
    custStatus.status,
    custInbox.status,
    custSend.status,
  ])

  const [afterCustomer] = await db
    .select({ onHand: inventory.onHand })
    .from(inventory)
    .where(eq(inventory.variantId, target.variantId))
  const [productAfterCustomer] = await db
    .select({ priceCents: products.priceCents, isActive: products.isActive })
    .from(products)
    .where(eq(products.id, target.productId))
  const settingsAfterCustomer = await getSettings(['max_qty_per_line'])

  check('and nothing they tried actually changed: stock', afterCustomer?.onHand === target.onHand, {
    was: target.onHand,
    now: afterCustomer?.onHand,
  })
  check(
    'nothing changed: price and visibility',
    productAfterCustomer?.priceCents === target.priceCents && productAfterCustomer?.isActive === true,
    productAfterCustomer,
  )
  check(
    'nothing changed: settings',
    settingsAfterCustomer.max_qty_per_line === settingsBefore.max_qty_per_line,
    settingsAfterCustomer,
  )

  /* ------------------------------------------------------ admin: pages -- */

  head('The shop owner')
  const adminLogin = await admin.post('/api/auth/login', { email: adminEmail, password: PASSWORD })
  check('signs in', adminLogin.status === 200 && admin.signedIn(), adminLogin.status)

  const expected: Record<string, string> = {
    '/admin': 'Needs attention',
    '/admin/homepage': 'Order of the page',
    '/admin/products': 'Products',
    '/admin/stock': 'Needs attention',
    '/admin/support': 'Customer Service',
    '/admin/emails': 'Abandoned bag',
    '/admin/emails/campaigns': 'New mailing',
    '/admin/emails/subscribers': 'Confirmed subscribers',
    '/admin/emails/activity': 'Email activity',
    '/admin/settings': 'Free delivery over',
  }
  for (const p of PAGES) {
    const r = await admin.get(p)
    check(`${p} opens and is the real page`, r.status === 200 && r.text.includes(expected[p]), {
      status: r.status,
      sawMarker: r.text.includes(expected[p]),
    })
  }

  const noIndex = await admin.get('/admin')
  check(
    'the panel asks search engines to stay out',
    /noindex/i.test(noIndex.text),
    noIndex.text.match(/<meta[^>]*robots[^>]*>/i)?.[0],
  )

  /* -------------------------------------------------------- admin: stock -- */

  head('Stock')
  const newOnHand = target.onHand + 7
  const setOk = await admin.post('/api/admin/stock', {
    variantId: target.variantId,
    onHand: newOnHand,
  })
  const [stored] = await db
    .select({ onHand: inventory.onHand, reserved: inventory.reserved })
    .from(inventory)
    .where(eq(inventory.variantId, target.variantId))
  check('an admin can set the count on the shelf', setOk.status === 200, setOk.json)
  check('and the database holds exactly that number', stored?.onHand === newOnHand, {
    expected: newOnHand,
    stored: stored?.onHand,
  })

  const bad = await admin.post('/api/admin/stock', { variantId: target.variantId, onHand: -1 })
  check('a negative count is refused (422)', bad.status === 422, bad.status)
  const notAnId = await admin.post('/api/admin/stock', { variantId: 'not-a-uuid', onHand: 5 })
  check('a malformed id is refused (422), not a 500', notAnId.status === 422, notAnId.status)

  /* Put units into a real customer cart, then try to set stock below them. */
  const shopper = visitor()
  const reserve = await shopper.post('/api/cart', { variantId: target.variantId, quantity: 2 })
  check('a shopper can put 2 in their bag', reserve.status === 200, reserve.json)

  const below = await admin.post('/api/admin/stock', { variantId: target.variantId, onHand: 1 })
  const [afterRefusal] = await db
    .select({ onHand: inventory.onHand })
    .from(inventory)
    .where(eq(inventory.variantId, target.variantId))
  check(
    'stock cannot be set below what live carts hold (409)',
    below.status === 409,
    { status: below.status, body: below.json },
  )
  check(
    'the refusal explains itself in words a shop owner can act on',
    /held in customer carts/i.test(message(below) ?? ''),
    message(below),
  )
  check('and the stored count is untouched by the refusal', afterRefusal?.onHand === newOnHand, {
    expected: newOnHand,
    stored: afterRefusal?.onHand,
  })

  /* ----------------------------------------------------- admin: product -- */

  head('Prices')
  const newPrice = target.priceCents + 500
  const priced = await admin.patch(`/api/admin/products/${target.productId}`, {
    priceCents: newPrice,
    salePriceCents: null,
    isActive: true,
  })
  const [pricedRow] = await db
    .select({ priceCents: products.priceCents, salePriceCents: products.salePriceCents })
    .from(products)
    .where(eq(products.id, target.productId))
  check('an admin can change a price', priced.status === 200, priced.json)
  check('the stored price is the one that was sent', pricedRow?.priceCents === newPrice, pricedRow)

  const upsideDown = await admin.patch(`/api/admin/products/${target.productId}`, {
    priceCents: newPrice,
    salePriceCents: newPrice + 100,
    isActive: true,
  })
  const [afterUpsideDown] = await db
    .select({ salePriceCents: products.salePriceCents })
    .from(products)
    .where(eq(products.id, target.productId))
  check('a sale price above the normal price is refused (422)', upsideDown.status === 422, upsideDown.status)
  check('and was not written', afterUpsideDown?.salePriceCents === null, afterUpsideDown)

  const ghost = await admin.patch('/api/admin/products/00000000-0000-4000-8000-000000000000', {
    priceCents: 1000,
    salePriceCents: null,
    isActive: true,
  })
  check('a product that does not exist gives 404', ghost.status === 404, ghost.status)

  head('Available / Sold out / Hidden')
  const pdpPath = `/en/products/${target.slug}`
  const [stockBeforeOut] = await db.select({ onHand: inventory.onHand }).from(inventory).where(eq(inventory.variantId, target.variantId))
  const markOut = await admin.patch(`/api/admin/products/${target.productId}`, { status: 'sold_out' })
  const [outRow] = await db
    .select({ isActive: products.isActive, availability: products.availability })
    .from(products)
    .where(eq(products.id, target.productId))
  check('an admin can mark a product sold out', markOut.status === 200 && outRow?.availability === 'SOLD_OUT' && outRow.isActive, outRow)
  const outPage = await visitor().get(pdpPath)
  check('its page still opens, and says Sold out', outPage.status === 200 && outPage.text.includes('Sold out'), outPage.status)
  const outCart = await visitor().post('/api/cart', { variantId: target.variantId, quantity: 1 })
  check('nobody can add it to a bag, whatever the stock says (409)', outCart.status === 409, outCart.json)
  const [stockDuringOut] = await db.select({ onHand: inventory.onHand }).from(inventory).where(eq(inventory.variantId, target.variantId))
  check('and its stock is untouched', stockDuringOut?.onHand === stockBeforeOut?.onHand, stockDuringOut)

  const hideIt = await admin.patch(`/api/admin/products/${target.productId}`, { status: 'hidden' })
  const hiddenPage = await visitor().get(pdpPath)
  const hiddenCart = await visitor().post('/api/cart', { variantId: target.variantId, quantity: 1 })
  check('hidden takes it off the shop (404)', hideIt.status === 200 && hiddenPage.status === 404, hiddenPage.status)
  check('and a hidden product cannot be put in a bag by calling the API (404)', hiddenCart.status === 404, hiddenCart.status)

  const back = await admin.patch(`/api/admin/products/${target.productId}`, { status: 'available' })
  const backCart = visitor()
  const backAdd = await backCart.post('/api/cart', { variantId: target.variantId, quantity: 1 })
  check('available puts it back on sale', back.status === 200 && backAdd.status === 200, backAdd.json)
  await backCart.post('/api/cart', { variantId: target.variantId, quantity: 0 })
  const badStatus = await admin.patch(`/api/admin/products/${target.productId}`, { status: 'deleted' })
  check('an unknown status is refused (422)', badStatus.status === 422, badStatus.status)

  /* ---------------------------------------------------- admin: settings -- */

  head('Settings reach the shop')
  const tighten = await admin.patch('/api/admin/settings', {
    ...settingsBefore,
    max_qty_per_line: 1,
  })
  check('an admin can save settings', tighten.status === 200, tighten.json)

  const overLimit = visitor()
  const refused = await overLimit.post('/api/cart', { variantId: target.variantId, quantity: 2 })
  check(
    'the storefront obeys the new limit on the very next request',
    refused.status === 409,
    { status: refused.status, body: refused.json },
  )
  const allowed = await overLimit.post('/api/cart', { variantId: target.variantId, quantity: 1 })
  check('one is still allowed', allowed.status === 200, allowed.json)

  const nonsense = await admin.patch('/api/admin/settings', {
    ...settingsBefore,
    reservation_ttl_seconds: 5,
  })
  check('a 5-second cart hold is refused (422)', nonsense.status === 422, nonsense.status)
  const prefix = await admin.patch('/api/admin/settings', {
    ...settingsBefore,
    order_number_prefix: 'not lower case',
  })
  check('a malformed order prefix is refused (422)', prefix.status === 422, prefix.status)

  /* ------------------------------------------------------------ tidy up -- */

  /* ----------------------------------------------------- homepage & photos -- */

  head('Homepage layout and photo order')
  const savedSections = await db.select().from(homepageSections)
  const savedItems = await db.select().from(homepageSectionItems)
  const savedPhotos = await db
    .select({ id: productImages.id, position: productImages.position })
    .from(productImages)
    .where(eq(productImages.productId, target.productId))

  const allProducts = await db.select({ id: products.id }).from(products)
  const [someCategory] = await db
    .select({ id: sql<string>`id` })
    .from(sql`categories`)
    .where(sql`parent_id is not null`)
    .limit(1)
  const fakeId = '00000000-0000-4000-8000-000000000001'
  const layoutBody = (order: string[]) => ({
    sections: order.map((key) => ({ key, isVisible: true, mode: 'auto' })),
  })

  for (const [who, v] of [['stranger', stranger], ['customer', customer]] as const) {
    const a = await v.put('/api/admin/homepage', layoutBody(['on_sale', 'new_in', 'trending', 'categories']))
    const b = await v.put('/api/admin/homepage/new_in', { ids: [target.productId] })
    const c = await v.put(`/api/admin/products/${target.productId}/images`, { ids: savedPhotos.map((x) => x.id) })
    check(`a ${who} cannot rearrange the homepage or photos (404 ×3)`, [a, b, c].every((r) => r.status === 404), [
      a.status,
      b.status,
      c.status,
    ])
  }
  const untouched = await db.select().from(homepageSections)
  check('and the layout is exactly as it was', untouched.length === savedSections.length, untouched)

  const missing = await admin.put('/api/admin/homepage', { sections: layoutBody(['on_sale', 'new_in', 'trending']).sections })
  const twice = await admin.put('/api/admin/homepage', layoutBody(['on_sale', 'on_sale', 'trending', 'categories']))
  check('a layout missing a section is refused (422)', missing.status === 422, missing.status)
  check('a layout with a section twice is refused (422)', twice.status === 422, twice.status)

  const reordered = await admin.put('/api/admin/homepage', layoutBody(['on_sale', 'new_in', 'trending', 'categories']))
  const home = await stranger.get('/en')
  const order = ['On sale', 'Just landed', 'Moving fast', 'Shop by category'].map((h) => home.text.indexOf(`>${h}<`))
  check('an admin can reorder the sections', reordered.status === 200, reordered.json)
  check(
    'and the homepage shows them in that order on the next request',
    order.every((pos, i) => pos > 0 && (i === 0 || pos > order[i - 1])),
    order,
  )

  /* The sign-up section: an older four-section layout keeps it where it is;
     a full list places it. */
  const withSignup = await admin.put(
    '/api/admin/homepage',
    layoutBody(['newsletter', 'on_sale', 'new_in', 'trending', 'categories']),
  )
  const home2 = await stranger.get('/en')
  const signupAt = home2.text.indexOf('Get first access to new products and offers.')
  const saleAt = home2.text.indexOf('>On sale<')
  check('the newsletter sign-up can be placed like any section', withSignup.status === 200 && signupAt > 0 && signupAt < saleAt, [
    withSignup.status,
    signupAt,
    saleAt,
  ])

  const wrongKind = await admin.put('/api/admin/homepage/categories', { ids: [target.productId] })
  const wrongKind2 = await admin.put('/api/admin/homepage/new_in', { ids: [someCategory.id] })
  const dupe = await admin.put('/api/admin/homepage/new_in', { ids: [target.productId, target.productId] })
  const ghostProduct = await admin.put('/api/admin/homepage/new_in', { ids: [fakeId] })
  const tooMany = await admin.put('/api/admin/homepage/new_in', {
    ids: Array.from({ length: 13 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`),
  })
  const noSuchSection = await admin.put('/api/admin/homepage/hero', { ids: [] })
  check('a product in "Shop by category" is refused (422)', wrongKind.status === 422, wrongKind.status)
  check('a category in "New in" is refused (422)', wrongKind2.status === 422, wrongKind2.status)
  check('the same product twice is refused (422)', dupe.status === 422, dupe.status)
  check('a product that does not exist is refused (422)', ghostProduct.status === 422, ghostProduct.status)
  check('more than the section holds is refused (422)', tooMany.status === 422, message(tooMany))
  check('a section that does not exist is 404', noSuchSection.status === 404, noSuchSection.status)

  const picks = allProducts.slice(0, 3).map((x) => x.id).reverse()
  const picked = await admin.put('/api/admin/homepage/new_in', { ids: picks })
  const manual = await admin.put('/api/admin/homepage', {
    sections: ['on_sale', 'new_in', 'trending', 'categories'].map((key) => ({
      key,
      isVisible: true,
      mode: key === 'new_in' ? 'manual' : 'auto',
    })),
  })
  const storedPicks = await db
    .select({ id: homepageSectionItems.productId })
    .from(homepageSectionItems)
    .where(eq(homepageSectionItems.sectionKey, 'new_in'))
    .orderBy(homepageSectionItems.position)
  check('an admin can hand-pick New in', picked.status === 200 && manual.status === 200, [picked.json, manual.json])
  check('and it is stored in exactly the order sent', storedPicks.map((r) => r.id).join() === picks.join(), storedPicks)

  const hide = await admin.put('/api/admin/homepage', {
    sections: ['on_sale', 'new_in', 'trending', 'categories'].map((key) => ({
      key,
      isVisible: key !== 'trending',
      mode: 'auto',
    })),
  })
  const hidden = await stranger.get('/en')
  check('a hidden section disappears from the homepage', hide.status === 200 && !hidden.text.includes('>Moving fast<'), hide.status)

  /* photos */
  const ids = savedPhotos.map((x) => x.id)
  if (ids.length >= 2) {
    const partial = await admin.put(`/api/admin/products/${target.productId}/images`, { ids: ids.slice(1) })
    const [otherPhoto] = await db
      .select({ id: productImages.id })
      .from(productImages)
      .where(sql`${productImages.productId} <> ${target.productId}`)
      .limit(1)
    const foreign = await admin.put(`/api/admin/products/${target.productId}/images`, {
      ids: [otherPhoto.id, ...ids.slice(1)],
    })
    const swapped = await admin.put(`/api/admin/products/${target.productId}/images`, {
      ids: [...ids].reverse(),
    })
    const [first] = await db
      .select({ id: productImages.id })
      .from(productImages)
      .where(eq(productImages.productId, target.productId))
      .orderBy(productImages.position)
      .limit(1)
    check('a partial photo list is refused (422)', partial.status === 422, partial.status)
    check("another product's photo is refused (422)", foreign.status === 422, foreign.status)
    check('an admin can reorder photos, and the new first is stored first', swapped.status === 200 && first.id === ids[ids.length - 1], {
      status: swapped.status,
      first: first?.id,
    })
  }

  /* put the homepage and photos back exactly */
  await db.delete(homepageSectionItems)
  await db.delete(homepageSections)
  if (savedSections.length) await db.insert(homepageSections).values(savedSections)
  if (savedItems.length) await db.insert(homepageSectionItems).values(savedItems)
  for (const ph of savedPhotos) {
    await db.update(productImages).set({ position: ph.position }).where(eq(productImages.id, ph.id))
  }

  head('Putting everything back')
  await overLimit.post('/api/cart', { variantId: target.variantId, quantity: 0 })
  await shopper.post('/api/cart', { variantId: target.variantId, quantity: 0 })

  for (const [key, value] of Object.entries(settingsBefore)) {
    await setSetting(key as keyof typeof SETTING_DEFAULTS, value as never)
  }
  await db
    .update(products)
    .set({ priceCents: target.priceCents, salePriceCents: target.salePriceCents, isActive: true, availability: 'AVAILABLE' })
    .where(eq(products.id, target.productId))
  await db
    .update(inventory)
    .set({ onHand: target.onHand })
    .where(eq(inventory.variantId, target.variantId))
  await db.delete(users).where(sql`${users.email} in (${adminEmail}, ${customerEmail})`)

  const [restored] = await db
    .select({ onHand: inventory.onHand })
    .from(inventory)
    .where(eq(inventory.variantId, target.variantId))
  const [restoredProduct] = await db
    .select({ priceCents: products.priceCents })
    .from(products)
    .where(eq(products.id, target.productId))
  const restoredSettings = await getSettings(['max_qty_per_line'])
  check('stock restored', restored?.onHand === target.onHand, restored)
  check('price restored', restoredProduct?.priceCents === target.priceCents, restoredProduct)
  check(
    'settings restored',
    restoredSettings.max_qty_per_line === settingsBefore.max_qty_per_line,
    restoredSettings,
  )

  if (failures === 0) {
    console.log('\n✓ the admin panel is closed to everyone who is not an admin, and works for one\n')
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
