/* ============================================================================
 * Customer Service and the newsletter, over real HTTP.
 *
 *     npm run check:service      (needs the site running: npm run dev)
 *
 * Proves against the running server:
 *
 *   · one guest cannot read or write another guest's conversation, even
 *     with its id; the conversation belongs to an http-only cookie;
 *   · staff replies arrive as "Customer Service", with no staff identity;
 *   · closing ends it for the customer, keeps it, and emails a transcript;
 *   · the inbox, replies and closing are closed to non-admins;
 *   · the newsletter refuses sign-ups without consent, answers every valid
 *     one identically, and confirms and unsubscribes only by signed link;
 *   · a guest gives a name and an email (a signed-in customer never does),
 *     and the automatic first reply arrives, marked as automatic;
 *   · Marketing & Emails is closed to non-admins; required emails cannot be
 *     switched off; unknown {{variables}} are refused; a test email goes
 *     only to the configured test address, never one in the request;
 *   · the idle-sweep and automation endpoints are closed without their secret.
 *
 * Creates its own accounts, subscribers and conversations and removes them.
 * ========================================================================== */

import './load-env'

import { eq, inArray, sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import { emailLog, newsletterSubscribers, supportConversations, users } from '../src/db/schema'
import { hashPassword } from '../src/lib/auth/password'
import { unsubscribeToken } from '../src/lib/newsletter'

const BASE = process.env.CHECK_BASE ?? 'http://localhost:3100'
const PASSWORD = 'Check-Service-Pass-47!'

type Reply = { status: number; text: string; json: Record<string, unknown> | undefined; setCookie: string[] }

function visitor() {
  let cookie = ''
  async function call(method: string, path: string, body?: unknown): Promise<Reply> {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...(cookie ? { Cookie: cookie } : {}),
        /* Each visitor looks like its own address to the rate limiter. */
        'X-Forwarded-For': ip,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
    })
    const setCookie = res.headers.getSetCookie?.() ?? []
    for (const c of setCookie) {
      const pair = c.split(';')[0]
      const name = pair.split('=')[0]
      cookie = cookie.split('; ').filter((p) => p && p.split('=')[0] !== name).concat(pair).join('; ')
    }
    const text = await res.text()
    let json: Record<string, unknown> | undefined
    try {
      json = text ? JSON.parse(text) : undefined
    } catch {
      json = undefined
    }
    return { status: res.status, text, json, setCookie }
  }
  const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b),
    put: (p: string, b?: unknown) => call('PUT', p, b),
    patch: (p: string, b?: unknown) => call('PATCH', p, b),
    del: (p: string) => call('DELETE', p),
    cookies: () => cookie,
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

async function main() {
  try {
    await fetch(BASE + '/en', { redirect: 'manual' })
  } catch {
    console.error(`\n✗ nothing is answering on ${BASE}.\n  Start the site first:  npm run dev\n`)
    process.exitCode = 1
    return
  }

  const stamp = Date.now()
  const adminEmail = `check-service-admin-${stamp}@example.com`
  const customerEmail = `check-service-customer-${stamp}@example.com`
  const guestEmail = `check-guest-${stamp}@example.com`
  const subEmail = `check-news-${stamp}@example.com`
  const hash = await hashPassword(PASSWORD)
  await db.insert(users).values([
    { email: adminEmail, phone: `+3576${String(stamp).slice(-7)}`, passwordHash: hash, firstName: 'Check', lastName: 'Staff', role: 'ADMIN', emailVerifiedAt: new Date() },
    { email: customerEmail, phone: `+3575${String(stamp).slice(-7)}`, passwordHash: hash, firstName: 'Check', lastName: 'Customer', role: 'CUSTOMER', emailVerifiedAt: new Date() },
  ])
  const conversationIds: string[] = []

  try {
    /* ------------------------------------------------ customer service -- */
    head('Customer Service — customers')
    const a = visitor()
    const b = visitor()

    const empty = await a.get('/api/support')
    check('opening the chat creates nothing', empty.status === 200 && empty.json?.conversation === null, empty.json)

    const noName = await a.post('/api/support', { email: guestEmail, message: 'Hi', locale: 'en' })
    const noEmail = await a.post('/api/support', { name: 'Check Guest', message: 'Hi', locale: 'en' })
    check(
      'a guest must give a name and an email (422)',
      noName.status === 422 && noName.json?.error === 'NAME_REQUIRED' && noEmail.status === 422 && noEmail.json?.error === 'EMAIL_REQUIRED',
      [noName.json, noEmail.json],
    )
    check('and nothing was created', (await a.get('/api/support')).json?.conversation === null)

    const start = await a.post('/api/support', { name: 'Check Guest', email: guestEmail, message: 'Do you have <b>this</b> in XS?', locale: 'en' })
    const convId = String(start.json?.conversationId ?? '')
    conversationIds.push(convId)
    check('a guest starts a conversation with a first message', start.status === 200 && Boolean(convId), start.json)
    const cookie = start.setCookie.find((c) => c.startsWith('sf_support='))
    check('and is given an http-only cookie for it', Boolean(cookie && /httponly/i.test(cookie) && /samesite=lax/i.test(cookie)), cookie)

    const mine = await a.get('/api/support')
    const msgs = (mine.json?.messages as { body: string }[] | undefined) ?? []
    check('they can read it back, exactly as typed', msgs[0]?.body === 'Do you have <b>this</b> in XS?', mine.json)
    const auto = (mine.json?.messages as { sender: string; body: string; automated?: boolean }[] | undefined)?.[1]
    check(
      'the automatic first reply arrives straight away, from Customer Service',
      auto?.sender === 'STAFF' && auto.automated === true && /Thank you for contacting AIONIX Customer Service/.test(auto.body),
      auto,
    )
    check('the panel never calls it a bot or an assistant', !/\b(bot|chatbot|ai assistant)\b/i.test(mine.text), mine.text.slice(0, 200))

    const theirs = await b.get('/api/support')
    check("another visitor sees no conversation", theirs.json?.conversation === null, theirs.json)
    const hijack = await b.post('/api/support/messages', { conversationId: convId, message: 'hijack' })
    check("and cannot write into it by id (404)", hijack.status === 404, hijack.status)

    const cust = visitor()
    await cust.post('/api/auth/login', { email: customerEmail, password: PASSWORD })
    const custView = await cust.get('/api/support')
    check('a signed-in customer does not see a guest’s conversation', custView.json?.conversation === null, custView.json)
    const custStart = await cust.post('/api/support', { name: 'Someone Else', email: 'spoof@example.com', message: 'Hi', locale: 'en' })
    conversationIds.push(String(custStart.json?.conversationId ?? ''))
    const [custConv] = await db.select().from(supportConversations).where(eq(supportConversations.id, String(custStart.json?.conversationId)))
    check('a signed-in customer’s own name and email are used, not what the form said', custConv?.email === customerEmail, custConv?.email)

    const blank = await a.post('/api/support/messages', { conversationId: convId, message: '   ' })
    const long = await a.post('/api/support/messages', { conversationId: convId, message: 'x'.repeat(2001) })
    check('empty and over-long messages are refused (422)', blank.status === 422 && long.status === 422, [blank.status, long.status])

    head('Customer Service — non-admins and the inbox')
    for (const [who, v] of [['stranger', b], ['customer', cust]] as const) {
      const list = await v.get('/api/admin/support')
      const thread = await v.get(`/api/admin/support/${convId}`)
      const reply = await v.post(`/api/admin/support/${convId}/messages`, { message: 'fake staff' })
      const close = await v.post(`/api/admin/support/${convId}/close`)
      check(`a ${who} cannot list, read, reply or close (404 ×4)`, [list, thread, reply, close].every((r) => r.status === 404), [
        list.status,
        thread.status,
        reply.status,
        close.status,
      ])
    }

    const staff = visitor()
    await staff.post('/api/auth/login', { email: adminEmail, password: PASSWORD })
    const inbox = await staff.get('/api/admin/support')
    const rows = (inbox.json?.rows as { id: string; unread: number }[] | undefined) ?? []
    check('the new conversation is in the inbox, unread', rows.some((r) => r.id === convId && r.unread > 0), inbox.json?.counts)
    const read = await staff.get(`/api/admin/support/${convId}`)
    check('staff can open it', read.status === 200, read.status)
    const reply = await staff.post(`/api/admin/support/${convId}/messages`, { message: 'Yes — XS is in stock.' })
    check('staff can reply', reply.status === 200, reply.json)

    const seen = await a.get('/api/support')
    const last = ((seen.json?.messages as { sender: string; body: string }[]) ?? []).at(-1)
    check('the customer sees the reply, from Customer Service', last?.sender === 'STAFF' && last.body === 'Yes — XS is in stock.', last)
    check('with nothing that says which staff member wrote it', !seen.text.includes('staffUserId') && !seen.text.includes('Check Staff'), seen.text.slice(0, 200))

    const staffMail = await db.select().from(emailLog).where(sql`${emailLog.kind} = 'support_new' and ${emailLog.relatedId} = ${convId}`)
    check('staff were emailed about the new conversation exactly once', staffMail.length === 1, staffMail.length)

    head('Customer Service — closing')
    const closed = await staff.post(`/api/admin/support/${convId}/close`)
    const again = await staff.post(`/api/admin/support/${convId}/close`)
    check('staff can close it; closing twice changes nothing', closed.json?.closed === true && again.json?.closed === false, [closed.json, again.json])
    const after = await a.get('/api/support')
    check('the customer sees that it has ended', (after.json?.conversation as { status?: string })?.status === 'CLOSED', after.json?.conversation)
    const late = await a.post('/api/support/messages', { conversationId: convId, message: 'one more thing' })
    check('and cannot write into a closed conversation (409)', late.status === 409, late.status)
    const transcript = await db.select().from(emailLog).where(sql`${emailLog.kind} = 'support_transcript' and ${emailLog.relatedId} = ${convId}`)
    check('the transcript went to the customer, once', transcript.length === 1 && transcript[0].toEmail === guestEmail, transcript.length)
    const fresh = await a.post('/api/support', { name: 'Check Guest', email: guestEmail, message: 'A new question', locale: 'en' })
    conversationIds.push(String(fresh.json?.conversationId ?? ''))
    check('they can start a new one; the old one is kept', fresh.json?.created === true && fresh.json.conversationId !== convId, fresh.json)

    const sweep = await b.post('/api/cron/support-sweep')
    check('the idle-sweep endpoint is closed without its secret (404)', sweep.status === 404, sweep.status)
    const tick = await b.post('/api/cron/automations')
    check('the automations endpoint is closed without its secret (404)', tick.status === 404, tick.status)

    /* ------------------------------------------------ marketing & emails -- */
    head('Marketing & Emails')
    for (const [who, v] of [['stranger', b], ['customer', cust]] as const) {
      const r = await Promise.all([
        v.put('/api/admin/emails/templates/welcome', { enabled: false }),
        v.post('/api/admin/emails/templates/welcome/preview', { locale: 'en' }),
        v.post('/api/admin/emails/templates/welcome/test', { locale: 'en' }),
        v.patch('/api/admin/emails/settings', { email_test_address: 'attacker@example.com' }),
        v.patch('/api/admin/support/settings', { support_auto_reply_enabled: false }),
      ])
      check(`a ${who} cannot edit, preview, test or configure emails (404 ×5)`, r.every((x) => x.status === 404), r.map((x) => x.status))
    }
    const [originalTest] = await db.execute<{ value: unknown }>(sql`select value from settings where key = 'email_test_address'`).then((x) => x.rows)
    try {
      await staff.patch('/api/admin/emails/settings', { email_test_address: '' })
      const noAddress = await staff.post('/api/admin/emails/templates/welcome/test', { locale: 'en' })
      check('without a test address, a test send is refused (409)', noAddress.status === 409 && noAddress.json?.error === 'NO_TEST_ADDRESS', noAddress.json)

      const testTo = `check-test-${stamp}@example.com`
      const set = await staff.patch('/api/admin/emails/settings', { email_test_address: testTo })
      check('the test address can be set', set.status === 200, set.json)
      const sneaky = await staff.post('/api/admin/emails/templates/welcome/test', { locale: 'el', to: 'someone-else@example.com' })
      const [testMail] = await db
        .select({ to: emailLog.toEmail, subject: emailLog.subject })
        .from(emailLog)
        .where(sql`${emailLog.kind} = 'welcome' and ${emailLog.createdAt} > now() - interval '1 minute'`)
        .orderBy(sql`${emailLog.createdAt} desc`)
        .limit(1)
      check('a test goes to the test address — whatever the request says', sneaky.status === 200 && testMail?.to === testTo, [sneaky.json, testMail])
      check('marked as a test, in the chosen language', /^\[Test\] Καλώς/.test(testMail?.subject ?? ''), testMail?.subject)
      await db.delete(emailLog).where(sql`lower(${emailLog.toEmail}) = ${testTo}`)

      const off = await staff.put('/api/admin/emails/templates/auth_verification', { enabled: false })
      check('a required email cannot be switched off (422)', off.status === 422, off.json)
      const bad = await staff.put('/api/admin/emails/templates/welcome', { content: { en: { body: 'Hi {{password}}' } } })
      check('a variable the email does not have is refused (422)', bad.status === 422 && /password/.test(String(bad.json?.message)), bad.json)
      const preview = await staff.post('/api/admin/emails/templates/abandoned_bag/preview', {
        locale: 'en',
        content: { en: { body: '<script>alert(1)</script> {{customer_name}}\n\n{{bag_items}}' } },
      })
      const html = String(preview.json?.html ?? '')
      check('the preview renders unsaved words, with typed HTML shown as text', preview.status === 200 && html.includes('&lt;script&gt;') && !html.includes('<script>'), html.slice(0, 120))
      const unknown = await staff.put('/api/admin/emails/templates/not_a_template', { enabled: true })
      check('an unknown email is 404', unknown.status === 404, unknown.status)

      for (const path of ['/admin/emails', '/admin/emails/abandoned_bag', '/admin/emails/campaigns', '/admin/emails/subscribers', '/admin/emails/activity', '/admin/emails/settings']) {
        const page = await staff.get(path)
        check(`${path} renders for staff`, page.status === 200, page.status)
      }
      const moved = await staff.get('/admin/newsletter')
      check('the old /admin/newsletter sends you to Campaigns', [307, 308].includes(moved.status), moved.status)
    } finally {
      /* Through the API, so the running server's settings cache sees it too. */
      await staff.patch('/api/admin/emails/settings', {
        email_test_address: typeof originalTest?.value === 'string' ? originalTest.value : '',
      })
    }

    /* ------------------------------------------------------ newsletter -- */
    head('Newsletter')
    const n = visitor()
    const noConsent = await n.post('/api/newsletter', { email: subEmail, consent: false, locale: 'en' })
    check('no consent, no sign-up (422)', noConsent.status === 422 && noConsent.json?.error === 'CONSENT_REQUIRED', noConsent.json)
    const badEmail = await n.post('/api/newsletter', { email: 'not-an-email', consent: true, locale: 'en' })
    check('a malformed address is refused (422)', badEmail.status === 422, badEmail.json)

    const first = await n.post('/api/newsletter', { email: subEmail, consent: true, locale: 'en', source: 'homepage' })
    const second = await visitor().post('/api/newsletter', { email: subEmail.toUpperCase(), consent: true, locale: 'en' })
    check('a valid sign-up and a repeat get the same answer', first.text === second.text && first.status === 200, [first.text, second.text])
    const subs = await db.select().from(newsletterSubscribers).where(sql`lower(${newsletterSubscribers.email}) = ${subEmail}`)
    check('one row, waiting for confirmation', subs.length === 1 && subs[0].status === 'PENDING', subs.map((s) => s.status))

    const bot = await visitor().post('/api/newsletter', { email: `bot-${stamp}@example.com`, consent: true, locale: 'en', website: 'http://spam' })
    const botRows = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.email, `bot-${stamp}@example.com`))
    check('a filled honeypot looks like success and stores nothing', bot.status === 200 && botRows.length === 0, botRows.length)

    const [{ body }] = await db
      .select({ body: emailLog.body })
      .from(emailLog)
      .where(sql`${emailLog.kind} = 'newsletter_confirm' and lower(${emailLog.toEmail}) = ${subEmail}`)
      .limit(1)
    const confirmPath = /(\/en\/newsletter\/confirm\?token=[^\s]+)/.exec(body ?? '')?.[1]
    const bogus = await n.get('/en/newsletter/confirm?token=bogus.token')
    check('a made-up confirmation link does nothing', bogus.status === 200 && bogus.text.includes('expired'), bogus.status)
    const confirmed = confirmPath ? await n.get(confirmPath) : null
    const [sub] = await db.select().from(newsletterSubscribers).where(sql`lower(${newsletterSubscribers.email}) = ${subEmail}`)
    check('the real link confirms the subscription', confirmed?.status === 200 && sub?.status === 'SUBSCRIBED', sub?.status)

    const wrong = await visitor().post('/api/newsletter/unsubscribe?token=abc.def')
    check('a forged unsubscribe token is refused (400)', wrong.status === 400, wrong.status)
    const oneClick = await fetch(`${BASE}/api/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken(sub.id))}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
    const [gone] = await db.select().from(newsletterSubscribers).where(eq(newsletterSubscribers.id, sub.id))
    check('a mail client’s one-click unsubscribe works without a login', oneClick.status === 200 && gone.status === 'UNSUBSCRIBED', gone.status)
    const getUnsub = await n.get(`/en/newsletter/unsubscribe?token=${encodeURIComponent(unsubscribeToken(sub.id))}`)
    check('the unsubscribe page asks before acting (a link scanner cannot unsubscribe anyone)', getUnsub.status === 200, getUnsub.status)
  } finally {
    head('Putting everything back')
    const ids = conversationIds.filter((id) => /^[0-9a-f-]{36}$/.test(id))
    if (ids.length) {
      await db.delete(emailLog).where(inArray(emailLog.relatedId, ids))
      await db.delete(supportConversations).where(inArray(supportConversations.id, ids))
    }
    await db.delete(emailLog).where(sql`lower(${emailLog.toEmail}) in (${subEmail}, ${guestEmail})`)
    await db.delete(newsletterSubscribers).where(sql`lower(${newsletterSubscribers.email}) in (${subEmail}, ${`bot-${stamp}@example.com`})`)
    await db.execute(sql`delete from marketing_consents where lower(email) = ${subEmail}`)
    await db.delete(users).where(sql`${users.email} in (${adminEmail}, ${customerEmail})`)
    console.log('  ✓ removed the test accounts, conversations and subscriber')
  }

  console.log(
    failures
      ? `\n✗ ${failures} check(s) failed\n`
      : '\n✓ Customer Service and the newsletter keep every conversation and address to its owner\n',
  )
  if (failures) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
