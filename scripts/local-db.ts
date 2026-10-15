/* ============================================================================
 * A Postgres on localhost with nothing to install.
 *
 *     npm run db:local
 *
 * PGlite is a real PostgreSQL compiled to WebAssembly, shipped as an npm
 * package. This script wraps it in a TCP server that speaks the normal
 * PostgreSQL wire protocol, so the app, the migration script, the seed and
 * `psql` all connect to it exactly as they would to an installed Postgres —
 * the application code does not know the difference and needs no changes.
 *
 * Why this exists: installing PostgreSQL on Windows means an installer, admin
 * rights, a service, a superuser password and a PATH entry, and any one of
 * those going wrong stops the whole project. This is `npm install`.
 *
 * What it is NOT: a production database. Queries are serialised through one
 * engine, so it will not demonstrate the concurrency behaviour the inventory
 * tests prove — those want a real server. For looking at the shop, working on
 * pages and seeding a catalogue, it is the real PostgreSQL 18 query planner,
 * constraints, triggers, generated columns and all.
 *
 * Leave it running in its own terminal. The data lives in ./.localdb and
 * survives a restart.
 * ========================================================================== */

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'

const DATA_DIR = process.env.LOCAL_DB_DIR ?? join(process.cwd(), '.localdb')
const PORT = Number(process.env.LOCAL_DB_PORT ?? 5432)
const HOST = '127.0.0.1'
/* The default is ONE, which means `npm run db:seed` or `npm run check` while
   `npm run dev` is running gets "Connection terminated unexpectedly" — the
   second client is simply dropped. Queries are queued inside the engine either
   way, so allowing several connections costs nothing and makes the ordinary
   two-terminal workflow work. */
const MAX_CONNECTIONS = Number(process.env.LOCAL_DB_MAX_CONNECTIONS ?? 20)

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  console.log('\n  starting an embedded PostgreSQL')
  console.log(`  data directory: ${DATA_DIR}`)

  /* pg_trgm is loaded because the product search uses trigram similarity for
     typos and partial words — see src/db/constraints.sql. */
  const db = await PGlite.create({ dataDir: DATA_DIR, extensions: { pg_trgm } })

  const { rows } = await db.query<{ version: string }>('select version()')
  console.log(`  ${rows[0].version.split(' on ')[0]}`)

  const server = new PGLiteSocketServer({
    db,
    port: PORT,
    host: HOST,
    maxConnections: MAX_CONNECTIONS,
  })

  try {
    await server.start()
  } catch (err) {
    const e = err as { code?: string }
    if (e.code === 'EADDRINUSE') {
      console.error(
        `\n✗ port ${PORT} is already in use.\n\n` +
          '  Something is already listening there — an installed PostgreSQL, or\n' +
          '  another copy of this script. Either use that one, or run this on a\n' +
          '  different port:\n\n' +
          `      $env:LOCAL_DB_PORT=5433; npm run db:local\n\n` +
          '  and point DATABASE_URL at the same port.\n',
      )
      await db.close()
      process.exitCode = 1
      return
    }
    throw err
  }

  console.log(`\n  listening on ${HOST}:${PORT} (up to ${MAX_CONNECTIONS} connections)\n`)

  /* When `npm run dev` started this, it owns the lifecycle and the advice below
     would be wrong — there is no window of its own to leave open. */
  if (!process.env.LOCAL_DB_SUPERVISED) {
    console.log(`      DATABASE_URL="postgresql://postgres@${HOST}:${PORT}/postgres"`)
    console.log('\n  Leave this window open — closing it stops the database, and')
    console.log('  the site will not load without it. Ctrl+C to stop.\n')
    console.log('  You do not normally need this window at all: `npm run dev`')
    console.log('  starts this database itself if nothing is already running.\n')
  }

  /* Close the engine cleanly so the data directory is not left mid-write. */
  let closing = false
  const shutdown = async () => {
    if (closing) return
    closing = true
    console.log('\n  stopping…')
    await server.stop()
    await db.close()
    process.exit(0)
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error('\n✗ could not start the local database:', err)
  process.exitCode = 1
})
