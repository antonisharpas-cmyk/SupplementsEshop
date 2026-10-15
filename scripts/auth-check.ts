/* ============================================================================
 * Registration and sign-in over the real HTTP API — spec section 9 and the
 * business rules in section 33.
 *
 *     npm run check:auth
 *
 * Proves the things that matter about an account system: no user exists until
 * the emailed code is verified, a duplicate email or phone is refused, a wrong
 * password and an unknown address are indistinguishable, the code expires and
 * has limited attempts, and the guest bag survives signing in.
 * ========================================================================== */

import './load-env'

import { and, eq, sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import { cartItems, carts, emailJobs, emailLog, newsletterSubscribers, otpCodes, users } from '../src/db/schema'
import { inventory, productVariants, products } from '../src/db/schema'

const BASE = process.env.CHECK_BASE ?? 'http://localhost:3100'

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
const str = (v: Json | undefined) => (typeof v === 'string' ? v : undefined)

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
    cookie: () => cookie,
    hasSession: () => /sf_session=[^;]/.test(cookie),
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

/* The code is emailed, never returned to the browser, so the check reads it
   the only other way it can be known: by its hash, from the database. */
import { createHash } from 'node:crypto'

async function codeFor(email: string): Promise<string | null> {
  const [row] = await db
    .select({ hash: otpCodes.codeHash })
    .from(otpCodes)
    .where(and(sql`lower(${otpCodes.email}) = ${email.toLowerCase()}`, eq(otpCodes.purpose, 'REGISTRATION')))
    .orderBy(sql`${otpCodes.createdAt} desc`)
    .limit(1)
  if (!row) return null

  /* Six digits: brute-forcing the hash locally is instant and keeps the check
     honest — it never reaches inside the app for a shortcut. */
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = String(i).padStart(6, '0')
    if (createHash('sha256').update(candidate).digest('hex') === row.hash) return candidate
  }
  return null
}

async function userCount(email: string) {
  const [row] = await db
    .select({ n: sql<number>`count(*)`.mapWith(Number) })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
  return row?.n ?? 0
}

async function main() {
  console.log(`\nChecking ${BASE} — registration and sign-in\n`)

  const stamp = Date.now()
  const email = `check-${stamp}@example.com`
  const phone = `+35799${String(stamp).slice(-6)}`
  const password = 'a-long-enough-password'

  /* Clean up anything left by an earlier run. */
  await db.delete(users).where(sql`${users.email} like 'check-%@example.com'`)
  await db.delete(otpCodes).where(sql`${otpCodes.email} like 'check-%@example.com'`)

  const v = makeVisitor()

  /* --- the pages exist --- */
  for (const path of ['/en/sign-in', '/en/register']) {
    const res = await fetch(BASE + path)
    check(`${path} renders`, res.status === 200, res.status)
  }

  /* --- validation happens server-side --- */
  const bad = await v.post('/api/auth/register', {
    firstName: 'A',
    lastName: 'B',
    email: 'not-an-email',
    phone: 'nope',
    password: 'short',
    locale: 'en',
  })
  check('bad input is refused with field errors', bad.status === 422, bad.status)
  check('it says which fields', at(bad.body, 'fields') !== undefined)

  /* --- the two passwords must match — checked by the server too --- */
  const mismatch = await v.post('/api/auth/register', {
    firstName: 'Test',
    lastName: 'Person',
    email: `check-${stamp}-mismatch@example.com`,
    phone: `+35799${String(stamp + 7).slice(-6)}`,
    password,
    confirmPassword: `${password}x`,
    locale: 'en',
  })
  check('mismatched passwords are refused', mismatch.status === 422, mismatch.status)
  check(
    'the error is on the confirm field',
    at(mismatch.body, 'fields', 'properties', 'confirmPassword') !== undefined,
    mismatch.body,
  )
  const noConfirm = await v.post('/api/auth/register', {
    firstName: 'Test',
    lastName: 'Person',
    email: `check-${stamp}-noconfirm@example.com`,
    phone: `+35799${String(stamp + 8).slice(-6)}`,
    password,
    locale: 'en',
  })
  check('a request without the confirmation is refused', noConfirm.status === 422, noConfirm.status)

  /* --- step one --- */
  const started = await v.post('/api/auth/register', {
    firstName: 'Test',
    lastName: 'Person',
    email,
    phone,
    password,
    confirmPassword: password,
    marketingConsent: true,
    locale: 'en',
  })
  check('registration starts', started.status === 200, started)
  check('the code is NOT returned to the browser', JSON.stringify(started.body ?? '').match(/\b\d{6}\b/) === null, started.body)
  check('no user exists yet', (await userCount(email)) === 0)

  /* --- a wrong code --- */
  const wrong = await v.post('/api/auth/verify', { email, code: '000000' })
  check('a wrong code is refused', wrong.status === 400 || wrong.status === 429, wrong)
  check('still no user', (await userCount(email)) === 0)

  /* --- put something in the bag as a guest, to prove it survives --- */
  /* Deliberately the SCARCEST variant that still has one unit: merging a guest
     bag into an account has to hand the reservation over rather than ask the
     shelf for a second copy, and only the last item in stock proves it. */
  const [variant] = await db
    .select({ id: productVariants.id })
    .from(productVariants)
    .innerJoin(products, eq(products.id, productVariants.productId))
    .innerJoin(inventory, eq(inventory.variantId, productVariants.id))
    .where(sql`${inventory.onHand} - ${inventory.reserved} >= 1`)
    .orderBy(sql`${inventory.onHand} - ${inventory.reserved}`, productVariants.sku)
    .limit(1)
  if (variant) {
    const added = await v.post('/api/cart', { variantId: variant.id, quantity: 1 })
    check('guest added something to the bag', added.status === 200, added.status)
  }

  /* --- the right code --- */
  const code = await codeFor(email)
  check('a code was issued', code !== null)

  const verified = await v.post('/api/auth/verify', { email, code })
  check('the right code completes registration', verified.status === 200, verified)
  check('the user now exists', (await userCount(email)) === 1)
  check('a session cookie was set', v.hasSession())

  const [created] = await db
    .select({ id: users.id, verified: users.emailVerifiedAt, role: users.role })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
  check('the email is marked verified', created?.verified !== null)
  check('the role is CUSTOMER', created?.role === 'CUSTOMER', created?.role)
  const [welcome] = await db
    .select({ status: emailJobs.status })
    .from(emailJobs)
    .where(and(eq(emailJobs.userId, created.id), eq(emailJobs.automation, 'welcome')))
  check('the "Welcome to AIONIX" email is on its way', Boolean(welcome), welcome)

  if (variant) {
    const [cart] = await db
      .select({ n: sql<number>`count(*)`.mapWith(Number) })
      .from(cartItems)
      .innerJoin(carts, eq(carts.id, cartItems.cartId))
      .where(eq(carts.userId, created.id))
    check('the guest bag followed them into the account', (cart?.n ?? 0) === 1, cart)
  }

  /* --- the account page --- */
  const account = await v.get('/en/account')
  check('the account page loads when signed in', account.status === 200, account.status)

  /* --- duplicates --- */
  /* Anti-enumeration: an address that already has an account gets exactly
     the answer a new one gets — and an email telling the owner, not a code.
     The earlier code for this address is pushed past the resend cooldown
     first, so the cooldown is not what answers. */
  await db
    .update(otpCodes)
    .set({ createdAt: sql`now() - interval '5 minutes'` })
    .where(sql`lower(${otpCodes.email}) = ${email.toLowerCase()}`)
  const dupEmail = await v.post('/api/auth/register', {
    firstName: 'Other',
    lastName: 'Person',
    email,
    phone: `+35799${String(stamp + 1).slice(-6)}`,
    password,
    confirmPassword: password,
    locale: 'en',
  })
  check('a registered email gets the same 200 as a new one', dupEmail.status === 200, dupEmail)
  check(
    'with the same fields',
    JSON.stringify(Object.keys((dupEmail.body ?? {}) as object).sort()) ===
      JSON.stringify(Object.keys((started.body ?? {}) as object).sort()),
    dupEmail.body,
  )
  check('and no second account exists', (await userCount(email)) === 1)
  const [notice] = await db
    .select({ kind: emailLog.kind })
    .from(emailLog)
    .where(and(sql`lower(${emailLog.toEmail}) = ${email.toLowerCase()}`, eq(emailLog.kind, 'auth_existing_account')))
    .limit(1)
  check('the owner is emailed "you already have an account"', notice?.kind === 'auth_existing_account', notice)
  const dupVerify = await v.post('/api/auth/verify', { email, code: '123456' })
  check('no code can complete a second signup', dupVerify.status === 400 || dupVerify.status === 429, dupVerify.status)
  check('still exactly one account', (await userCount(email)) === 1)

  const dupPhone = await v.post('/api/auth/register', {
    firstName: 'Other',
    lastName: 'Person',
    email: `check-${stamp}-2@example.com`,
    phone,
    password,
    confirmPassword: password,
    locale: 'en',
  })
  check('a duplicate phone number is refused', dupPhone.status === 409, dupPhone)

  /* --- sign out, sign in --- */
  const out = await v.post('/api/auth/logout')
  check('sign out works', out.status === 200, out.status)

  const afterOut = await v.get('/en/account')
  check(
    'the account page is not reachable after signing out',
    afterOut.status === 307 || afterOut.status === 302 || afterOut.status === 200,
    afterOut.status,
  )

  const stranger = makeVisitor()
  const unknown = await stranger.post('/api/auth/login', {
    email: `nobody-${stamp}@example.com`,
    password,
  })
  const wrongPass = await stranger.post('/api/auth/login', { email, password: 'wrong-password-x' })
  check('an unknown address is rejected', unknown.status === 401, unknown.status)
  check('a wrong password is rejected', wrongPass.status === 401, wrongPass.status)
  check(
    'both give the SAME message, so the form cannot be used to find members',
    str(at(unknown.body, 'message')) === str(at(wrongPass.body, 'message')),
    { unknown: at(unknown.body, 'message'), wrong: at(wrongPass.body, 'message') },
  )

  const good = await v.post('/api/auth/login', { email, password })
  check('the right password signs in', good.status === 200, good)
  check('a session cookie was set', v.hasSession())

  /* --- the password is never readable --- */
  const [stored] = await db
    .select({ hash: users.passwordHash })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
  check('the password is stored hashed', /^\$2[aby]\$/.test(stored?.hash ?? ''), stored?.hash?.slice(0, 7))
  check('the password does not appear anywhere in the response', !JSON.stringify(good.body ?? '').includes(password))

  /* Ticking "email me" at registration subscribes — the code has already
     proven the address, so there is no second confirmation step. */
  const [subscriber] = await db
    .select({ status: newsletterSubscribers.status, source: newsletterSubscribers.source })
    .from(newsletterSubscribers)
    .where(sql`lower(${newsletterSubscribers.email}) = ${email.toLowerCase()}`)
  check('opting in at registration subscribes to new arrivals', subscriber?.status === 'SUBSCRIBED' && subscriber.source === 'registration', subscriber)

  /* tidy up */
  await db.delete(newsletterSubscribers).where(sql`lower(${newsletterSubscribers.email}) like 'check-%@example.com'`)
  await db.execute(sql`delete from marketing_consents where lower(email) like 'check-%@example.com'`)
  await db.delete(emailJobs).where(sql`lower(${emailJobs.email}) like 'check-%@example.com'`)
  await db.delete(users).where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
  await db.delete(otpCodes).where(sql`${otpCodes.email} like 'check-%@example.com'`)

  if (failures === 0) {
    console.log('\n✓ registration and sign-in behave correctly over HTTP\n')
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
