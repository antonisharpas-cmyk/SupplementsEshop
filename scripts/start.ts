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
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
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

let db: { stop(): Promise<void> } | null = null
let site: ChildProcess | null = null
let stopping = false

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (site && site.exitCode === null) {
    site.kill('SIGTERM')
    await new Promise((r) => site!.once('exit', r))
  }
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
  const prep = spawn(NODE, script('prepare-db'), { stdio: 'inherit', env })
  const status = await new Promise<number>((r) => prep.once('exit', (code) => r(code ?? 1)))
  if (status !== 0) {
    console.error('✗ database preparation failed, the site was not started.')
    return stop(status)
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
