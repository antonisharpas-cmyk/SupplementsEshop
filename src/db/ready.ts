/* ============================================================================
 * "Is the database actually usable?"
 *
 * Checked once per process, before the first real query, so a setup problem
 * reports itself as a setup problem. Without this the developer sees whichever
 * select happened to run first, with the real cause ("relation does not exist",
 * "connection refused") buried underneath and often truncated by the error
 * overlay.
 *
 * Three distinct failures, three distinct messages:
 *   - cannot reach the server at all       -> DatabaseUnreachableError
 *   - reached it, but it has no tables      -> SchemaNotReadyError
 *   - has tables, but is behind the code    -> SchemaOutOfDateError
 *
 * The third is the one that bites during development: new code arrives (a
 * pull, a delivered change, a hot reload) that reads a column the database
 * has not been given yet, and the page dies with "Failed query: select …".
 * On this machine's own database, in development, the missing updates are
 * simply applied — the same idempotent migrations `npm run db:push` runs —
 * and the page renders. Anywhere else it stops with the command to run,
 * because changing a remote schema is a decision, not a side effect.
 * ========================================================================== */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { sql } from 'drizzle-orm'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import journal from '../../drizzle/meta/_journal.json'
import { db } from './index'
import { describeConnection } from './ssl'
import { syncMedia } from '@/lib/media-sync'

/** How many migrations this version of the code expects to have been applied. */
const EXPECTED_MIGRATIONS = journal.entries.length

export class SchemaNotReadyError extends Error {
  constructor(missing: string) {
    super(
      `The database is reachable but empty — the "${missing}" table does not exist.\n\n` +
        'Create the schema and the demo data:\n\n' +
        '    npm run db:push\n' +
        '    npm run db:seed\n',
    )
    this.name = 'SchemaNotReadyError'
  }
}

export class SchemaOutOfDateError extends Error {
  constructor(applied: number, expected: number) {
    const behind = expected - applied
    super(
      `The database is ${behind} update${behind === 1 ? '' : 's'} behind the code ` +
        `(${applied} of ${expected} applied).\n\n` +
        'Apply them — nothing is deleted:\n\n' +
        '    npm run db:push\n\n' +
        'On your own machine, restarting `npm run dev` does this for you.\n',
    )
    this.name = 'SchemaOutOfDateError'
  }
}

export class DatabaseUnreachableError extends Error {
  constructor(target: string, cause: string, advice: string) {
    super(
      `Cannot reach the database at ${target}.\n\n${cause}\n\n${advice}\n\n` +
        'For a full diagnosis:  npm run db:check\n',
    )
    this.name = 'DatabaseUnreachableError'
  }
}

/* What each driver failure actually means, and what to do about it. */
function adviceFor(code: string | undefined, message: string, isLocal: boolean): string {
  if (code === 'ECONNREFUSED') {
    return isLocal
      ? 'Nothing is listening on that port. If you are using the embedded database,\n' +
          'start the site with `npm run dev` — it starts the database for you — and\n' +
          'reload this page. If you installed PostgreSQL yourself,\n' +
          'start its service:  Start-Service postgresql-x64-17'
      : 'Nothing is listening there. Check the database is running in your\n' +
          'provider\'s dashboard.'
  }
  if (code === 'ENOTFOUND') {
    return 'That hostname does not resolve. On Render, use the EXTERNAL Database URL —\n' +
      'the internal one only works from inside Render.'
  }
  if (code === 'ETIMEDOUT' || /timeout/i.test(message)) {
    return 'The server did not answer in time. It may be asleep or suspended, or a\n' +
      'network between you and it is blocking the database port.'
  }
  if (/self.signed certificate/i.test(message) || code === 'SELF_SIGNED_CERT_IN_CHAIN') {
    return 'The certificate is not signed by a CA Node trusts. Add this to .env.local:\n\n' +
      '    DATABASE_SSL=no-verify'
  }
  if (/no encryption|SSL.*required|does not support SSL/i.test(message)) {
    return 'That server requires TLS. Add DATABASE_SSL=require to .env.local.'
  }
  if (/password authentication failed/i.test(message)) {
    return 'The password in DATABASE_URL is wrong. Copy the connection string again.'
  }
  if (/database .* does not exist|role .* does not exist/i.test(message)) {
    return 'The database or user named in DATABASE_URL does not exist on that server.'
  }
  return 'Check DATABASE_URL in .env.local.'
}

/* Kept on globalThis because dev-mode hot reloads re-evaluate this module.
   Keyed by the migration count the code expects: when new code arrives with a
   new migration, the old "all good" answer no longer applies and the check
   runs again — which is precisely the moment it matters. */
const globalForReady = globalThis as unknown as {
  __schemaReady?: Promise<void>
  __schemaReadyFor?: number
}

async function check(): Promise<void> {
  const url = process.env.DATABASE_URL ?? ''
  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(url)

  let result
  try {
    result = await db.execute<{ exists: boolean }>(
      sql`select to_regclass('public.categories') is not null as exists`,
    )
  } catch (err) {
    /* Drizzle wraps driver errors, so the code and message are on the cause. */
    let cursor: unknown = err
    let code: string | undefined
    let message = ''
    for (let i = 0; i < 8 && cursor; i++) {
      const e = cursor as { code?: string; message?: string; cause?: unknown }
      if (typeof e.code === 'string' && !code) code = e.code
      if (e.message) message = e.message
      cursor = e.cause
    }

    throw new DatabaseUnreachableError(
      describeConnection(url),
      `${code ? code + ': ' : ''}${message}`,
      adviceFor(code, message, isLocal),
    )
  }

  if (!result.rows[0]?.exists) throw new SchemaNotReadyError('categories')

  const selfHeal = process.env.NODE_ENV === 'development' && isLocal

  /* --- is it as new as the code? --- */
  const applied = await appliedMigrations()
  if (applied !== null && applied < EXPECTED_MIGRATIONS) {
    if (!selfHeal) throw new SchemaOutOfDateError(applied, EXPECTED_MIGRATIONS)

    await migrate(db, { migrationsFolder: join(process.cwd(), 'drizzle') })
    /* The hand-written CHECK constraints travel with every migration run. */
    await db.execute(sql.raw(readFileSync(join(process.cwd(), 'src/db/constraints.sql'), 'utf8')))
    console.log(
      `\n  ✓ database updated — applied ${EXPECTED_MIGRATIONS - applied} pending migration(s)`,
    )
  }

  /* --- and pointing at the pictures that are actually in /public? ---
     New photographs or a new hero video arrive as files; without this they
     would sit unused until someone re-seeded (and wiped the accounts). */
  if (selfHeal) {
    try {
      const changed = await syncMedia(db)
      if (changed) console.log(`  ✓ media — ${changed} picture link(s) updated\n`)
    } catch (err) {
      /* Pictures are not worth refusing to render the shop over. */
      console.warn('  ! media sync skipped:', err instanceof Error ? err.message : err)
    }
  }
}

/** Rows in drizzle's own bookkeeping table, or null when it is absent (a
 *  database built some other way, whose history cannot be read). */
async function appliedMigrations(): Promise<number | null> {
  const exists = await db.execute<{ exists: boolean }>(
    sql`select to_regclass('drizzle.__drizzle_migrations') is not null as exists`,
  )
  if (!exists.rows[0]?.exists) return null
  const counted = await db.execute<{ n: number }>(
    sql`select count(*)::int as n from drizzle.__drizzle_migrations`,
  )
  return Number(counted.rows[0]?.n ?? 0)
}

/** Resolves once the database is reachable and migrated; throws a readable
 *  error if it is not. */
export function assertSchemaReady(): Promise<void> {
  /* Cache the successful answer only. A failed check must be retried, so that
     starting the database or running the migrations and refreshing the page is
     enough — no server restart. */
  if (!globalForReady.__schemaReady || globalForReady.__schemaReadyFor !== EXPECTED_MIGRATIONS) {
    globalForReady.__schemaReadyFor = EXPECTED_MIGRATIONS
    globalForReady.__schemaReady = check().catch((err) => {
      globalForReady.__schemaReady = undefined
      throw err
    })
  }
  return globalForReady.__schemaReady
}
