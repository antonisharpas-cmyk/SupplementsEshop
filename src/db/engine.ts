/* ============================================================================
 * What kind of PostgreSQL are we talking to?
 *
 * The local development database (npm run db:local) is PGlite: a real
 * PostgreSQL compiled to WebAssembly. Its planner, constraints, triggers and
 * generated columns are the genuine article — which is why the whole shop runs
 * on it — but there is exactly ONE engine behind the socket, so statements from
 * different connections are queued rather than executed at the same time.
 *
 * That matters for precisely one kind of test: the ones that open two
 * transactions at once and let them fight over the same row. On a single
 * engine the second transaction waits for the first to finish, and a test that
 * holds both open deadlocks instead of racing. Those tests are not wrong and
 * they are not optional — they guard the last-item-in-stock and
 * duplicate-account rules — so they are skipped with a reason here rather than
 * weakened to pass on a laptop. Point the test database at a real PostgreSQL
 * server and they run.
 * ========================================================================== */

import { sql } from 'drizzle-orm'
import { db } from './index'

let cached: boolean | null = null

/** True when the database serialises concurrent transactions (PGlite). */
export async function isSingleEngineDatabase(): Promise<boolean> {
  if (cached !== null) return cached
  try {
    const result = await db.execute(sql`select version() as version`)
    const version = String((result.rows[0] as { version?: unknown } | undefined)?.version ?? '')
    cached = /pglite/i.test(version)
  } catch {
    /* If we cannot tell, assume a real server: a test that then fails is a
       better outcome than one that silently never runs. */
    cached = false
  }
  return cached
}

export const SINGLE_ENGINE_REASON =
  'needs a real PostgreSQL server — two transactions cannot be open at once on PGlite'
