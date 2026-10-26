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

export function hit(key: string, limit: number, windowSeconds: number, now = Date.now(), weight = 1): Limit {
  /* Forget expired windows now and then so the map cannot grow forever. */
  if (now - lastSweep > 60_000) {
    for (const [k, w] of windows) if (w.resetAt <= now) windows.delete(k)
    lastSweep = now
  }
  const w = windows.get(key)
  if (!w || w.resetAt <= now) {
    if (weight > limit) return { ok: false, retryAfterSeconds: windowSeconds }
    windows.set(key, { count: weight, resetAt: now + windowSeconds * 1000 })
    return { ok: true }
  }
  if (w.count + weight > limit) return { ok: false, retryAfterSeconds: Math.ceil((w.resetAt - now) / 1000) }
  w.count += weight
  return { ok: true }
}

/** Several limits at once (a short one against bursts and a long one against
 *  a slow steady script). All must pass; a refused call is not counted in
 *  the later windows. */
export function hitAll(checks: [key: string, limit: number, windowSeconds: number][], weight = 1): Limit {
  for (const [key, limit, seconds] of checks) {
    const r = hit(key, limit, seconds, Date.now(), weight)
    if (!r.ok) return r
  }
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
