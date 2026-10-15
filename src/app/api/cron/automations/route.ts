/* ============================================================================
 * POST /api/cron/automations — one tick of everything that runs on a clock:
 * quiet support conversations close, due automated emails (welcome,
 * abandoned bag, order updates, back in stock, review request) go out, and
 * scheduled campaigns start.
 *
 * The server's own timer (src/instrumentation.ts) does this every 30 seconds
 * while the site runs. This route is for hosts without a long-running process
 * (serverless): call it every minute with `Authorization: Bearer <CRON_SECRET>`.
 * Running both is safe — jobs are claimed with a row lock, so none is sent twice.
 * ========================================================================== */

import { runAutomations } from '@/lib/automations'
import { cronAuthorised } from '@/lib/cron-auth'

async function run(request: Request) {
  if (!cronAuthorised(request)) return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  const result = await runAutomations()
  return Response.json({ ok: true, ...result }, { headers: { 'Cache-Control': 'no-store' } })
}

export const POST = run
export const GET = run
