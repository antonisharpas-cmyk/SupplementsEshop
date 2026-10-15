/* ============================================================================
 * POST /api/newsletter/unsubscribe?token=…
 *
 * Two callers:
 *   - a mail client's own "Unsubscribe" button (RFC 8058 one-click: a form
 *     POST with List-Unsubscribe=One-Click to the URL in the header), and
 *   - the button on /newsletter/unsubscribe.
 *
 * Deliberately not GET: link scanners in corporate mail open every link in an
 * email, and a GET that unsubscribes would take people off the list without
 * them ever seeing it. The token is signed, so it only ever unsubscribes the
 * person it was issued to.
 * ========================================================================== */

import { unsubscribe } from '@/lib/newsletter'

export async function POST(request: Request) {
  const url = new URL(request.url)
  let token = url.searchParams.get('token')
  if (!token) {
    try {
      const type = request.headers.get('content-type') ?? ''
      if (type.includes('application/json')) token = ((await request.json()) as { token?: string }).token ?? null
      else token = (await request.formData()).get('token')?.toString() ?? null
    } catch {
      token = null
    }
  }
  const result = await unsubscribe(token)
  return Response.json(
    { ok: result.ok, error: result.ok ? undefined : 'INVALID_TOKEN' },
    { status: result.ok ? 200 : 400, headers: { 'Cache-Control': 'no-store' } },
  )
}
