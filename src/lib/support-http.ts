/* The request-side glue for Customer Service routes: who is asking, and the
   guest cookie. Kept apart from lib/support.ts so that file stays testable
   without a request. */

import { cookies } from 'next/headers'
import { getCurrentUser } from '@/lib/auth/session'
import { SUPPORT_COOKIE, SUPPORT_COOKIE_MAX_AGE, SupportError, newGuestToken, type SupportActor } from '@/lib/support'

export async function currentActor(): Promise<SupportActor & { user: Awaited<ReturnType<typeof getCurrentUser>> }> {
  const [user, jar] = await Promise.all([getCurrentUser(), cookies()])
  const raw = jar.get(SUPPORT_COOKIE)?.value ?? null
  /* Only a token of the shape we issue is ever looked up. */
  const guestToken = raw && /^[A-Za-z0-9_-]{40,60}$/.test(raw) ? raw : null
  return { user, userId: user?.id ?? null, guestToken }
}

/** A guest starting a conversation gets a token cookie; it is the only key to it. */
export async function ensureGuestToken(actor: SupportActor): Promise<SupportActor> {
  if (actor.guestToken || actor.userId) return actor
  const token = newGuestToken()
  const jar = await cookies()
  jar.set(SUPPORT_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SUPPORT_COOKIE_MAX_AGE,
  })
  return { ...actor, guestToken: token }
}

export const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

export function supportErrorResponse(err: unknown, where: string) {
  if (err instanceof SupportError) {
    const status = err.code === 'NOT_FOUND' ? 404 : err.code === 'CLOSED' ? 409 : 422
    return json({ ok: false, error: err.code, message: err.message }, status)
  }
  console.error(`[${where}] failed`, err)
  return json({ ok: false, error: 'FAILED' }, 500)
}
