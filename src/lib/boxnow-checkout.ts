/* The BOX NOW locker a customer picked on the map, checked on the server.

   The map runs in the browser, so what it reports is only a claim. The locker
   id is looked up in BOX NOW's own list (with our credentials) and its name,
   address and postcode are taken from there. If BOX NOW cannot be reached at
   that moment the order is not lost: the browser's details are kept, marked
   unverified, and BOX NOW checks the id again when staff create the shipment
   (a wrong locker is refused there with P402). */

import type { PickupPoint } from '@/db/schema'
import { BoxNowError, boxnowStatus, findLocker } from '@/lib/boxnow'
import { CheckoutError, type PaymentMethod } from '@/lib/orders'

export async function resolveLocker(
  claim: { id: string; name: string; address: string; postalCode: string } | undefined,
  paymentMethod: PaymentMethod,
): Promise<PickupPoint> {
  const status = boxnowStatus()
  if (!status.checkout) throw new CheckoutError('Delivery to a BOX NOW locker is not available right now.', 'NO_DELIVERY')
  if (!claim?.id || !/^[A-Za-z0-9_-]{1,40}$/.test(claim.id)) {
    throw new CheckoutError('Choose a BOX NOW locker on the map.', 'ADDRESS_REQUIRED')
  }
  if (paymentMethod === 'cod' && !status.cod) {
    throw new CheckoutError('Orders to a BOX NOW locker are paid by card.', 'UNAVAILABLE')
  }

  let locker = null
  let verified = false
  try {
    locker = await findLocker(claim.id)
    if (!locker) throw new CheckoutError('That BOX NOW locker is not available. Choose another one on the map.', 'ADDRESS_REQUIRED')
    verified = true
  } catch (err) {
    if (err instanceof CheckoutError) throw err
    if (!(err instanceof BoxNowError)) throw err
    console.error('[boxnow] locker not verified at checkout, kept for staff:', err.message)
  }

  const name = (locker?.name || locker?.title || claim.name || `Locker ${claim.id}`).trim().slice(0, 160)
  const address = (locker ? [locker.addressLine1, locker.addressLine2].filter(Boolean).join(', ') : claim.address).trim().slice(0, 200)
  const postalCode = (locker?.postalCode || claim.postalCode || '').replace(/\s/g, '')
  if (locker && locker.country && !/^cy/i.test(locker.country)) {
    throw new CheckoutError('We deliver within Cyprus only. Choose a locker in Cyprus.', 'ADDRESS_REQUIRED')
  }
  if (!/^[1-8]\d{3}$/.test(postalCode)) {
    throw new CheckoutError('We deliver within Cyprus only. Choose a locker in Cyprus.', 'ADDRESS_REQUIRED')
  }
  return { provider: 'boxnow', id: claim.id, name, address, postalCode, verified }
}
