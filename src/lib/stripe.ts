/* ============================================================================
 * Stripe, for card payments.
 *
 * Customers pay on Stripe's own hosted page (Stripe Checkout): card numbers
 * never touch this server, which keeps the shop out of most PCI scope, and
 * Apple Pay and Google Pay come for free.
 *
 * Without STRIPE_SECRET_KEY the shop still works; card payment is simply not
 * offered at checkout, and cash on delivery remains.
 * ========================================================================== */

import Stripe from 'stripe'

let client: Stripe | null = null

export function stripeEnabled(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY)
}

export function stripe(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY is not set.')
  if (!client) client = new Stripe(process.env.STRIPE_SECRET_KEY)
  return client
}

/** Stripe Checkout speaks all three of the shop's languages. */
export function stripeLocale(locale: string): 'en' | 'el' | 'ru' {
  return locale === 'el' ? 'el' : locale === 'ru' ? 'ru' : 'en'
}
