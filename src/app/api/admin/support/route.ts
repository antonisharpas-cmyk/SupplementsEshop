/* GET /api/admin/support?status=OPEN|CLOSED|ALL&q= — the inbox list, for polling. */

import { requireAdminApi } from '@/lib/admin'
import { inboxCounts, listInbox } from '@/lib/support'
import { json } from '@/lib/support-http'

export async function GET(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const url = new URL(request.url)
  const raw = url.searchParams.get('status')
  const status = raw === 'CLOSED' || raw === 'ALL' ? raw : 'OPEN'
  const [list, counts] = await Promise.all([
    listInbox({ status, q: url.searchParams.get('q') ?? undefined, page: Number(url.searchParams.get('page')) || 1 }),
    inboxCounts(),
  ])
  return json({ ok: true, ...list, counts })
}
