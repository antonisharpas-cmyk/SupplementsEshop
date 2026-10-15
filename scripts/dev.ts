/* ============================================================================
 * `npm run dev` — one command, one terminal.
 *
 *     npm run dev
 *
 * Starting a web server and a database in two terminals and keeping both alive
 * is a ritual, not a design, and forgetting half of it produces an error about
 * ECONNREFUSED rather than "you forgot the other window". So this supervises
 * the whole thing:
 *
 *   1. Is anything listening where DATABASE_URL points? If yes, use it and
 *      touch nothing — that is your own PostgreSQL, or Render, and none of
 *      this applies.
 *   2. If not, and the address is on this machine, start the embedded
 *      PostgreSQL (scripts/local-db.ts) and wait for it.
 *   3. On a local database: apply any new migrations; seed it if it is
 *      empty; point it at whatever photos and hero video are in /public.
 *   4. Start Next.
 *
 * Ctrl+C stops both. The database keeps its data in ./.localdb, so the next
 * start skips steps 3 and 4's setup entirely.
 *
 * Nothing here runs in production: `npm run build` and `npm start` are
 * untouched, and this file is never imported by the app.
 * ========================================================================== */

import './load-env'

import { spawn, type ChildProcess } from 'node:child_process'
import { connect } from 'node:net'
import { createRequire } from 'node:module'
import { Client } from 'pg'
import { sslFor } from '../src/db/ssl'

const require = createRequire(import.meta.url)
/* Resolved rather than assumed: node_modules/.bin holds .cmd shims on Windows
   that cannot be spawned without a shell, and spawning through a shell is how
   paths with spaces — "…\source\repos\fitness maniacs\…" — break. */
const TSX = require.resolve('tsx/cli')
const NEXT = require.resolve('next/dist/bin/next')

const PORT = process.env.PORT ?? '3100'
const children: ChildProcess[] = []

/* ------------------------------------------------------------------ helpers -- */

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`

function portIsOpen(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port })
    const done = (open: boolean) => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => done(true))
    socket.once('timeout', () => done(false))
    socket.once('error', () => done(false))
  })
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0'])

/** Run a script to completion, showing its output. Rejects on a non-zero exit. */
function run(label: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit' })
    children.push(child)
    child.on('error', reject)
    child.on('exit', (code) =>
      code === 0 ? resolve() : reject(new Error(`${label} exited with code ${code}`)),
    )
  })
}

/* ------------------------------------------------------------- the database -- */

async function startEmbeddedDatabase(host: string, port: number): Promise<void> {
  console.log(dim(`  no database on ${host}:${port} — starting the embedded one`))

  const child = spawn(process.execPath, [TSX, 'scripts/local-db.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, LOCAL_DB_PORT: String(port), LOCAL_DB_SUPERVISED: '1' },
  })
  children.push(child)

  /* Its output is prefixed rather than hidden: when it fails — a port already
     taken, a data directory it cannot write — the reason has to be on screen,
     not swallowed by a spinner. */
  let failed: string | null = null
  const relay = (chunk: Buffer) => {
    const text = chunk.toString()
    if (/✗|Error|EADDRINUSE|EACCES/.test(text)) failed = text.trim()
    for (const line of text.split('\n')) {
      if (line.trim()) console.log(dim(`  db │ ${line.trimEnd()}`))
    }
  }
  child.stdout?.on('data', relay)
  child.stderr?.on('data', relay)

  const deadline = Date.now() + 90_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `the embedded database stopped before it was ready.\n${failed ?? ''}\n\n` +
          '  Run it on its own to see why:  npm run db:local',
      )
    }
    if (await portIsOpen(host, port)) return
    await new Promise((r) => setTimeout(r, 400))
  }
  throw new Error('the embedded database did not start within 90 seconds.')
}

/* ---------------------------------------------------------------- the schema -- */

/** Returns what is missing, so the caller can fix exactly that and no more. */
async function inspectSchema(url: string): Promise<'no-tables' | 'no-data' | 'ready'> {
  const client = new Client({ connectionString: url, ssl: sslFor(url), connectionTimeoutMillis: 15_000 })
  await client.connect()
  try {
    const { rows } = await client.query(
      `select to_regclass('public.products') is not null as has_tables`,
    )
    if (!rows[0]?.has_tables) return 'no-tables'
    const counted = await client.query('select count(*)::int as n from products')
    return counted.rows[0]?.n > 0 ? 'ready' : 'no-data'
  } finally {
    await client.end()
  }
}

/* -------------------------------------------------------------------- main -- */

async function main() {
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error(
      '\n✗ DATABASE_URL is not set.\n\n' +
        '  The committed .env.development supplies one for local development.\n' +
        '  If it is missing, copy .env.example to .env.local and fill it in.\n',
    )
    process.exit(1)
  }

  const parsed = new URL(url)
  const host = parsed.hostname
  const port = Number(parsed.port || 5432)
  const isLocal = LOCAL_HOSTS.has(host)

  if (!(await portIsOpen(host, port))) {
    if (!isLocal) {
      console.error(
        `\n✗ nothing answered at ${host}:${port}.\n\n` +
          '  That is a remote database, so this cannot start it for you.\n' +
          '  For a full diagnosis:  npm run db:check\n',
      )
      process.exit(1)
    }
    await startEmbeddedDatabase(host, port)
  }

  const state = await inspectSchema(url)
  if (state === 'no-tables') {
    console.log(dim('  first run — applying the schema'))
    await run('db:push', [TSX, 'scripts/db-push.ts'])
    console.log(dim('  seeding the catalogue'))
    await run('db:seed', [TSX, 'scripts/seed.ts'])
  } else if (isLocal) {
    /* On this machine's own database, keep it in step with the code on every
       start: a pulled change that adds a column would otherwise surface as a
       "column does not exist" error on the homepage. Migrations are
       idempotent, so an up-to-date schema costs a second. Never done to a
       remote database — changing Render's schema is a deliberate act, not a
       side effect of starting a dev server. */
    await run('db:push', [TSX, 'scripts/db-push.ts'])
    if (state === 'no-data') {
      console.log(dim('  empty catalogue — seeding'))
      await run('db:seed', [TSX, 'scripts/seed.ts'])
    }
  }

  /* New photographs or a new hero video dropped into /public show up on the
     next start, without a re-seed wiping accounts and stock. */
  if (isLocal) await run('media:sync', [TSX, 'scripts/sync-media.ts'])

  /* Checked before Next is started, because Next's own EADDRINUSE arrives as a
     stack trace and the fix is one environment variable. */
  if (await portIsOpen('127.0.0.1', Number(PORT))) {
    console.error(
      `\n✗ something is already using port ${PORT}.\n\n` +
        `  If it is another copy of this site, use that one: http://localhost:${PORT}\n` +
        '  Otherwise start this one somewhere else:\n\n' +
        `      $env:PORT=3200; npm run dev      (PowerShell)\n` +
        `      PORT=3200 npm run dev            (macOS / Linux)\n`,
    )
    shutdown()
    process.exit(1)
  }

  const next = spawn(process.execPath, [NEXT, 'dev', '-p', PORT], { stdio: 'inherit' })
  children.push(next)
  next.on('exit', (code) => {
    shutdown()
    process.exit(code ?? 0)
  })
}

/* ---------------------------------------------------------------- shutdown -- */

let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  for (const child of children) {
    if (child.exitCode === null) child.kill()
  }
}

process.on('SIGINT', () => {
  shutdown()
  process.exit(0)
})
process.on('SIGTERM', () => {
  shutdown()
  process.exit(0)
})

main().catch((err: unknown) => {
  shutdown()
  console.error(`\n✗ ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
