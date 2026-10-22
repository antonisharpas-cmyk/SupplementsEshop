/* ============================================================================
 * BOX NOW tells us a parcel changed (CloudEvents, type
 * "gr.boxnow.parcel_event_change", data.parcelId).
 *
 * Register with BOX NOW: https://<your site>/api/boxnow/webhook
 * (add ?token=<BOXNOW_WEBHOOK_TOKEN> if you set one).
 *
 * The body is only a nudge. Its signature scheme is not published, so instead
 * of trusting it the parcel's real state is read back from BOX NOW's API with
 * our own credentials. A forged call can at most make us ask BOX NOW again.
 * Always 200 for parcels we do not know, so BOX NOW stops retrying.
 * ========================================================================== */

import { timingSafeEqual } from 'node:crypto'
import { boxnowConfig, boxnowStatus } from '@/lib/boxnow'
import { refreshByParcelId } from '@/lib/shipments'

function sameSecret(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

export async function POST(request: Request) {
  if (!boxnowStatus().api) return new Response('Not configured', { status: 404 })
  const expected = boxnowConfig().webhookToken
  if (expected && !sameSecret(new URL(request.url).searchParams.get('token') ?? '', expected)) {
    return new Response('Not found', { status: 404 })
  }

  const body = (await request.json().catch(() => null)) as { subject?: unknown; data?: { parcelId?: unknown } } | null
  const parcelId = String(body?.data?.parcelId ?? body?.subject ?? '').trim()
  if (!/^[A-Za-z0-9-]{4,40}$/.test(parcelId)) return new Response('ok')

  try {
    await refreshByParcelId(parcelId)
  } catch (err) {
    console.error('[boxnow webhook] refresh failed', parcelId, err instanceof Error ? err.message : err)
    /* A 500 makes BOX NOW try again later, when its API may answer. */
    return new Response('Failed', { status: 500 })
  }
  return new Response('ok')
}
