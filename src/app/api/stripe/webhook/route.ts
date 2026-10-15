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
 * checkout.session.expired and charge.refunded.
 * ========================================================================== */

import { handleStripeEvent } from '@/lib/orders'
import { stripe, stripeEnabled } from '@/lib/stripe'

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

  try {
    await handleStripeEvent(event as unknown as { id: string; type: string; data: { object: unknown } })
  } catch (err) {
    console.error('[stripe webhook] failed', event.type, err)
    /* A 500 makes Stripe try again later, which is what we want. */
    return new Response('Failed', { status: 500 })
  }
  return new Response('ok')
}
