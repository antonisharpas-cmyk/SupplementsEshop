/* ============================================================================
 * Stripe, for card payments.
 *
 * Customers pay on Stripe's own hosted page (Stripe Checkout): card numbers
 * never touch this server, which keeps the shop out of most PCI scope, and
 * Apple Pay and Google Pay come for free.
 *
 * Without STRIPE_SECRET_KEY the shop still works; card payment is simply not
 * offered at checkout, and cash on delivery remains.
 *
 * TEST MODE ONLY, for now. A live key (sk_live_…, rk_live_…) is refused, and
 * card payment is switched off, unless STRIPE_ALLOW_LIVE=yes is also set. That
 * is a deliberate step for launch day, so a live key pasted into the wrong box
 * can never take real money from a test site.
 * ========================================================================== */

import Stripe from 'stripe'

let client: Stripe | null = null
let warned = false

export type StripeMode = 'test' | 'live' | 'off'

/** The key as typed into Render, forgiving the usual paste slips: quotes
 *  around it, spaces, or the name pasted in front ("STRIPE_SECRET_KEY=…"). */
function secretKey(): string {
  return (process.env.STRIPE_SECRET_KEY ?? '')
    .trim()
    .replace(/^STRIPE_SECRET_KEY\s*=\s*/i, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .trim()
}

/** For Admin, Settings: what the server actually received, without revealing
 *  the secret (only the kind of key, from its first characters). */
export function stripeKeyDiagnosis(): string {
  const raw = process.env.STRIPE_SECRET_KEY
  if (raw === undefined) return 'STRIPE_SECRET_KEY is not set on this server at all.'
  const key = secretKey()
  if (!key) return 'STRIPE_SECRET_KEY is set but empty.'
  const kind = key.startsWith('pk_')
    ? 'a publishable key (pk_…). Use the Secret key (sk_test_…) instead'
    : key.startsWith('whsec_')
      ? 'the webhook signing secret (whsec_…). That belongs in STRIPE_WEBHOOK_SECRET'
      : /^(sk|rk)_live_/.test(key)
        ? 'a LIVE key. Use the test key (sk_test_…)'
        : /^(sk|rk)_test_/.test(key)
          ? 'a test secret key: correct'
          : `not a Stripe key (it starts with "${key.slice(0, 3)}…")`
  return `STRIPE_SECRET_KEY is ${kind}.`
}

/** Which Stripe account the key belongs to: test, live, or none (or refused). */
export function stripeMode(): StripeMode {
  const key = secretKey()
  if (!key) return 'off'
  if (/^(sk|rk)_test_/.test(key)) return 'test'
  if (/^(sk|rk)_live_/.test(key)) {
    if (process.env.STRIPE_ALLOW_LIVE === 'yes') return 'live'
    if (!warned) {
      warned = true
      console.error(
        '[stripe] STRIPE_SECRET_KEY is a LIVE key. Card payment is switched off: this shop runs in test mode. ' +
          'Use the test key (sk_test_…), or set STRIPE_ALLOW_LIVE=yes when you really go live.',
      )
    }
    return 'off'
  }
  if (!warned) {
    warned = true
    console.error('[stripe] STRIPE_SECRET_KEY is not a Stripe secret key (sk_test_…). Card payment is switched off.')
  }
  return 'off'
}

export function stripeEnabled(): boolean {
  return stripeMode() !== 'off'
}

/** True while payments go to Stripe's test account: no real money moves. */
export function stripeTestMode(): boolean {
  return stripeMode() === 'test'
}

export function stripe(): Stripe {
  if (!stripeEnabled()) throw new Error('Card payment is not configured (STRIPE_SECRET_KEY missing or refused).')
  if (!client) client = new Stripe(secretKey())
  return client
}

/** Stripe Checkout speaks all three of the shop's languages. */
export function stripeLocale(locale: string): 'en' | 'el' | 'ru' {
  return locale === 'el' ? 'el' : locale === 'ru' ? 'ru' : 'en'
}
