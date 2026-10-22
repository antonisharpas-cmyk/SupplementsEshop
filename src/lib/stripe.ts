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

/** Which Stripe account the key belongs to: test, live, or none (or refused). */
export function stripeMode(): StripeMode {
  const key = process.env.STRIPE_SECRET_KEY?.trim()
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
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY!.trim())
  return client
}

/** Stripe Checkout speaks all three of the shop's languages. */
export function stripeLocale(locale: string): 'en' | 'el' | 'ru' {
  return locale === 'el' ? 'el' : locale === 'ru' ? 'ru' : 'en'
}
