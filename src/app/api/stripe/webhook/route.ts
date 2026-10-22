/* ============================================================================
 * Stripe tells us about payments here.
 *
 * Every request is checked against STRIPE_WEBHOOK_SECRET before anything is
 * read, and every event is handled once (lib/orders.ts records the ids), so a
 * forged or repeated call changes nothing.
 *
 * Set it up in the Stripe dashboard: Developers, Webhooks, add endpoint
 * https://<your site>/api/stripe/webhook with the events
 * checkout.session.completed, checkout.session.async_payment_succeeded,
 * checkout.session.async_payment_failed, checkout.session.expired,
 * payment_intent.payment_failed and charge.refunded.
 *
 * In test mode, events from the live account are ignored (and the other way
 * round), so the two can never mix.
 * ========================================================================== */

import { handleStripeEvent } from '@/lib/orders'
import { stripe, stripeEnabled, stripeTestMode } from '@/lib/stripe'

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripeEnabled() || !secret) return new Response('Not configured', { status: 404 })

  const signature = request.headers.get('stripe-signature')
  if (!signature) return new Response('Missing signature', { status: 400 })
  const body = await request.text()

  let event
  try {
    event = await stripe().webhooks.constructEventAsync(body, signature, secret)
  } catch {
    return new Response('Bad signature', { status: 400 })
  }

  if (Boolean((event as { livemode?: boolean }).livemode) === stripeTestMode()) {
    return new Response('ok, ignored: other mode')
  }

  try {
    await handleStripeEvent(event as unknown as { id: string; type: string; data: { object: unknown } })
  } catch (err) {
    console.error('[stripe webhook] failed', event.type, err)
    /* A 500 makes Stripe try again later, which is what we want. */
    return new Response('Failed', { status: 500 })
  }
  return new Response('ok')
}
