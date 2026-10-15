/* ============================================================================
 * Sign out.
 *
 * POST, not GET: a link that signs you out can be triggered by any page that
 * embeds it as an image, and a prefetch would log people out at random.
 *
 * The session row is deleted, not just the cookie — otherwise the token stays
 * valid for anyone who copied it.
 * ========================================================================== */

import { clearSessionCookie, revokeCurrentSession } from '@/lib/auth/session'

export async function POST() {
  try {
    await revokeCurrentSession()
  } catch (err) {
    console.error('[api/auth/logout] revoke failed', err)
  }

  /* Clear the cookie even if the row was already gone. */
  await clearSessionCookie()

  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
