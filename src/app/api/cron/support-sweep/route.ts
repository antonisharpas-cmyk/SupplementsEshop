/* ============================================================================
 * POST /api/cron/support-sweep — close quiet conversations.
 *
 * The server's own timer (src/instrumentation.ts) already does this every 30
 * seconds while the site runs. This route is for hosts where a long-running
 * timer is not possible (serverless): point the platform's scheduler at it,
 * every minute, with `Authorization: Bearer <CRON_SECRET>`.
 *
 * /api/cron/automations does this AND sends due emails; prefer that one.
 *
 * The rule never depends on either: every read of a conversation closes it
 * first if it is past its idle time.
 * ========================================================================== */

import { sweepIdleConversations } from '@/lib/support'
import { cronAuthorised as authorised } from '@/lib/cron-auth'

async function run(request: Request) {
  if (!authorised(request)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  const closed = await sweepIdleConversations()
  return Response.json({ ok: true, closed }, { headers: { 'Cache-Control': 'no-store' } })
}

export const POST = run
export const GET = run
