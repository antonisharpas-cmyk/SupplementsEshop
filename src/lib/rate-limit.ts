/* ============================================================================
 * A small fixed-window rate limiter for public endpoints that are not sign-in
 * (sign-in and codes are limited in the database — see lib/auth).
 *
 * In memory, per server process: enough to stop a script hammering the
 * newsletter form or the chat from one address. Behind several server
 * instances each keeps its own count; move this to Redis or the database
 * then. The call sites do not change.
 * ========================================================================== */

import { createHash } from 'node:crypto'

type Window = { count: number; resetAt: number }
const windows = new Map<string, Window>()
let lastSweep = Date.now()

export type Limit = { ok: true } | { ok: false; retryAfterSeconds: number }

export function hit(key: string, limit: number, windowSeconds: number, now = Date.now()): Limit {
  /* Forget expired windows now and then so the map cannot grow forever. */
  if (now - lastSweep > 60_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k)
    lastSweep = now
  }
  const w = windows.get(key)
  if (!w || w.resetAt <= now) {
    windows.set(key, { count: 1, resetAt: now + windowSeconds * 1000 })
    return { ok: true }
  }
  if (w.count >= limit) return { ok: false, retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) }
  w.count += 1
  return { ok: true }
}

/** Tests only. */
export function resetRateLimits() {
  windows.clear()
}

/** The caller's address, hashed — used as a limiter key and never stored raw.
 *  The LAST X-Forwarded-For entry is the one the nearest proxy (the host's
 *  load balancer) appended; anything before it was supplied by the client
 *  and could be invented to dodge the limit. */
export function clientKey(request: Request): string {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',').at(-1)?.trim() ||
    request.headers.get('x-real-ip') ||
    'local'
  return createHash('sha256').update(ip).digest('hex').slice(0, 32)
}
