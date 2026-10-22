/* GET /api/admin/boxnow: "Test connection" in Admin, Settings. Signs in to
   BOX NOW with the configured credentials and lists the account's
   warehouses (to pick BOXNOW_WAREHOUSE_ID) and how many lockers it serves. */

import { requireAdminApi } from '@/lib/admin'
import { BoxNowError, boxnowStatus, listLockers, listOrigins } from '@/lib/boxnow'
import { fail, json } from '@/lib/api'

export async function GET() {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const status = boxnowStatus()
  if (!status.api) return fail(409, 'NOT_CONFIGURED', `BOX NOW is not set up. Missing: ${status.missing.join(', ')}.`)
  try {
    const [origins, lockers] = await Promise.all([listOrigins(), listLockers()])
    return json({
      ok: true,
      origins: origins.map((o) => ({ id: o.id, name: o.name || o.title, address: [o.addressLine1, o.postalCode].filter(Boolean).join(', ') })),
      lockers: lockers.length,
    })
  } catch (err) {
    if (err instanceof BoxNowError) return fail(409, 'REFUSED', err.message)
    console.error('[api/admin/boxnow] failed', err)
    return fail(500, 'FAILED', 'Could not reach BOX NOW.')
  }
}
