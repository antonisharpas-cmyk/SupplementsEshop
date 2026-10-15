/* Shared by the /api/cron/* routes: a bearer token equal to CRON_SECRET, or
   nothing. Without CRON_SECRET set the routes do not exist (404). */

import { timingSafeEqual } from 'node:crypto'

export function cronAuthorised(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  const given = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  return given.length === expected.length && timingSafeEqual(given, expected)
}
