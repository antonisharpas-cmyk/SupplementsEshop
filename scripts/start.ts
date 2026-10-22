/* ============================================================================
 * `npm start`: how the live site starts (Render runs this).
 *
 * Two ways to have a database:
 *
 *   DATABASE_URL         a real Postgres (Render Postgres). The usual way.
 *
 *   EMBEDDED_DB_DIR      a folder on a Render persistent disk, e.g.
 *                        /var/data/aionix-db. The embedded PostgreSQL (the same
 *                        one `npm run dev` uses, scripts/local-db.ts) runs
 *                        inside this service and keeps its files there, so
 *                        they survive deploys and restarts. DATABASE_URL is
 *                        then ignored.
 *
 *   The embedded database is for testing: one engine for every visitor, no
 *   backups except Render's daily disk snapshot, one copy of the site only,
 *   and a short outage on every deploy. Move to Render Postgres before launch.
 *
 * Then: database tables, starting data and admin accounts
 * (scripts/prepare-db.ts), then the site (`next start`). On SIGTERM (a deploy
 * or restart) the site stops first and the database closes cleanly last, so
 * its files are never left half written.
 * ========================================================================== */

import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { startEmbedded } from './pg-embedded'

/* Children are started with this same Node directly (no npx, npm or shell in
   between), so a stop signal reaches them and nothing is left running. The
   compiled scripts from `npm run build` (dist-server/) are used when present:
   no TypeScript compiler in memory on the server. */
const NODE = process.execPath
const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next')
const script = (name: string) => {
  const compiled = join(process.cwd(), 'dist-server', `${name}.mjs`)
  return existsSync(compiled) ? [compiled] : ['--import', 'tsx', join('scripts', `${name}.ts`)]
}

const EMBEDDED_DIR = process.env.EMBEDDED_DB_DIR?.trim()
const DB_PORT = Number(process.env.EMBEDDED_DB_PORT ?? 5433)
const env: NodeJS.ProcessEnv = { ...process.env }

let db: Awaited<ReturnType<typeof startEmbedded>> | null = null
let site: ChildProcess | null = null
let inProcess: { close(): Promise<void> } | null = null
let stopping = false

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (site && site.exitCode === null) {
    site.kill('SIGTERM')
    await new Promise((r) => site!.once('exit', r))
  }
  if (inProcess) await inProcess.close().catch(() => undefined)
  /* The database closes last, cleanly, so its files are never half written. */
  if (db) await db.stop().catch((err) => console.error('database did not close cleanly', err))
  process.exit(code)
}

process.on('SIGTERM', () => void stop(0))
process.on('SIGINT', () => void stop(0))

async function main() {
  if (EMBEDDED_DIR) {
    console.log(`▶ Embedded database on the disk: ${EMBEDDED_DIR}`)
    console.log('  (for testing; move to Render Postgres before launch)')
    /* In this same process: one Node instead of two saves memory. */
    db = await startEmbedded(EMBEDDED_DIR, DB_PORT)
    console.log(`  ready (${Math.round(process.memoryUsage().rss / 1048576)} MB)`)
    env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${DB_PORT}/postgres`
    /* Inside the service: no TLS, and a few connections (queries queue in the engine). */
    env.DATABASE_SSL = 'disable'
    env.DATABASE_POOL_MAX = env.EMBEDDED_DB_POOL_MAX ?? '3'
  }

  /* Not spawnSync: this process also serves the database, so it must stay free. */
  const run = async (label: string, args: string[], extra: Record<string, string> = {}) => {
    console.log(`\n▶ ${label}`)
    const child = spawn(NODE, args, { stdio: 'inherit', env: { ...env, ...extra } })
    const status = await new Promise<number>((r) => child.once('exit', (code) => r(code ?? 1)))
    if (status !== 0) {
      console.error(`✗ ${label} failed, the site was not started.`)
      await stop(status)
    }
  }

  if (db) {
    /* Embedded: everything that can run inside this process does, so a
       normal restart starts no extra programs at all (512 MB servers). */
    console.log('\n▶ Database tables')
    await migrate(drizzle(db.db), { migrationsFolder: join(process.cwd(), 'drizzle') })
    await db.db.exec(readFileSync(join(process.cwd(), 'src/db/constraints.sql'), 'utf8'))
    console.log('✓ schema is up to date')

    const { rows } = await db.db.query<{ n: number }>('select count(*)::int as n from categories')
    if (rows[0].n === 0) {
      const seedPassword = env.SEED_ADMIN_PASSWORD || env.STAFF_SUPPORT_PASSWORD
      if (!seedPassword) {
        console.error('✗ New database, but no STAFF_SUPPORT_PASSWORD to create the first admin with.')
        return stop(1)
      }
      await run('Starting data (new database)', script('seed'), { SEED_ADMIN_PASSWORD: seedPassword })
    } else {
      console.log('\n▶ Starting data: the shop already has data, nothing changed.')
    }

    /* Only when an admin account is missing; existing ones keep their passwords anyway. */
    const staff = await db.db.query<{ n: number }>(
      `select count(*)::int as n from users where lower(email) in ('info@ergonsite.com','andreasgeorgiou816@gmail.com','info@vs.supply','stavrosprokopiou93@gmail.com')`,
    )
    if (staff.rows[0].n < 4) await run('Admin accounts', [...script('staff'), '--if-configured'])
    else console.log('\n▶ Admin accounts: all present.')
    if (stopping) return
    console.log('\n✓ database ready, starting the site\n')
  } else {
    await run('Database', script('prepare-db'))
    if (stopping) return
  }

  if (db) {
    /* Embedded on a small server: the shop runs in this same process as the
       database, which saves a whole second Node (about 50 MB). */
    Object.assign(process.env, env, { NODE_ENV: 'production' })
    const { default: next } = await import('next')
    const app = next({ dev: false, dir: process.cwd() })
    const handle = app.getRequestHandler()
    await app.prepare()
    const port = Number(process.env.PORT ?? 3000)
    const server = createServer((req, res) => void handle(req, res))
    await new Promise<void>((r) => server.listen(port, '0.0.0.0', r))
    inProcess = {
      close: () =>
        new Promise<void>((r) => {
          server.close(() => r())
          server.closeAllConnections()
        }).then(() => app.close()),
    }
    console.log(`✓ site listening on port ${port} (${Math.round(process.memoryUsage().rss / 1048576)} MB in use)`)
    return
  }

  /* A small server: keep the site's JavaScript heap modest so the database
     keeps its share (override with SITE_MAX_HEAP_MB). */
  const heap = env.SITE_MAX_HEAP_MB ?? (EMBEDDED_DIR ? '128' : '')
  const siteEnv = heap ? { ...env, NODE_OPTIONS: `${env.NODE_OPTIONS ?? ''} --max-old-space-size=${heap}`.trim() } : env
  site = spawn(NODE, [NEXT_BIN, 'start'], { stdio: 'inherit', env: siteEnv })
  site.once('exit', (code) => {
    if (!stopping) void stop(code ?? 1)
  })
}

main().catch((err) => {
  console.error('✗ could not start:', err instanceof Error ? err.message : err)
  void stop(1)
})
