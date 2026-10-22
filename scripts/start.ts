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

import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { createRequire } from 'node:module'
import { connect } from 'node:net'

/* Children are started with this same Node directly (no npx, npm or shell in
   between), so a stop signal reaches them and nothing is left running. */
const NODE = process.execPath
const NEXT_BIN = createRequire(import.meta.url).resolve('next/dist/bin/next')

const EMBEDDED_DIR = process.env.EMBEDDED_DB_DIR?.trim()
const DB_PORT = Number(process.env.EMBEDDED_DB_PORT ?? 5433)
const env: NodeJS.ProcessEnv = { ...process.env }

let db: ChildProcess | null = null
let site: ChildProcess | null = null
let stopping = false

function waitForPort(port: number, ms: number) {
  const until = Date.now() + ms
  return new Promise<void>((resolve, reject) => {
    const tryOnce = () => {
      const s = connect(port, '127.0.0.1')
      s.once('connect', () => {
        s.destroy()
        resolve()
      })
      s.once('error', () => {
        s.destroy()
        if (Date.now() > until) reject(new Error(`the embedded database did not start within ${ms / 1000}s`))
        else setTimeout(tryOnce, 300)
      })
    }
    tryOnce()
  })
}

async function stop(code = 0) {
  if (stopping) return
  stopping = true
  if (site && site.exitCode === null) {
    site.kill('SIGTERM')
    await new Promise((r) => site!.once('exit', r))
  }
  if (db && db.exitCode === null) {
    /* local-db.ts closes the engine on SIGTERM before exiting. */
    db.kill('SIGTERM')
    await Promise.race([new Promise((r) => db!.once('exit', r)), new Promise((r) => setTimeout(r, 20_000))])
  }
  process.exit(code)
}

process.on('SIGTERM', () => void stop(0))
process.on('SIGINT', () => void stop(0))

async function main() {
  if (EMBEDDED_DIR) {
    console.log(`▶ Embedded database on the disk: ${EMBEDDED_DIR}`)
    console.log('  (for testing; move to Render Postgres before launch)')
    db = spawn(NODE, ['--import', 'tsx', 'scripts/local-db.ts'], {
      stdio: 'inherit',
      env: { ...process.env, LOCAL_DB_DIR: EMBEDDED_DIR, LOCAL_DB_PORT: String(DB_PORT), LOCAL_DB_SUPERVISED: '1' },
    })
    db.once('exit', (code) => {
      if (!stopping) {
        console.error(`✗ the embedded database stopped (code ${code}). Stopping the site.`)
        void stop(1)
      }
    })
    await waitForPort(DB_PORT, 120_000)
    env.DATABASE_URL = `postgresql://postgres@127.0.0.1:${DB_PORT}/postgres`
    /* Inside the service: no TLS, and a few connections (queries queue in the engine). */
    env.DATABASE_SSL = 'disable'
    env.DATABASE_POOL_MAX = env.EMBEDDED_DB_POOL_MAX ?? '4'
  }

  const prep = spawnSync(NODE, ['--import', 'tsx', 'scripts/prepare-db.ts'], { stdio: 'inherit', env })
  if (prep.status !== 0) {
    console.error('✗ database preparation failed, the site was not started.')
    return stop(prep.status ?? 1)
  }

  site = spawn(NODE, [NEXT_BIN, 'start'], { stdio: 'inherit', env })
  site.once('exit', (code) => {
    if (!stopping) void stop(code ?? 1)
  })
}

main().catch((err) => {
  console.error('✗ could not start:', err instanceof Error ? err.message : err)
  void stop(1)
})
