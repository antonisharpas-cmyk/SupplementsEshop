/* Runs before the live site starts (`npm start`), so a deploy never needs a
   hand-run database step:

     1. creates or updates the tables (the same migrations `npm run db:push`
        applies; it only ever adds, never deletes)
     2. on a brand new, empty database only, fills in the starting data:
        categories, delivery options, settings and the demo products
        (`npm run db:seed`). Once the shop has categories this step is skipped
        for good, so real orders and products are never touched.
     3. creates the admin accounts if their passwords are set in the
        environment (STAFF_SUPPORT_PASSWORD, STAFF_SHAREHOLDER_PASSWORD).
        Existing accounts keep the password their owner chose.

   It runs here rather than in the build because Render's build step cannot
   reach the database's internal address; the running service can. */

import './load-env'
import { spawnSync } from 'node:child_process'
import { Pool } from 'pg'
import { sslFor } from '../src/db/ssl'

const TSX = process.platform === 'win32' ? 'tsx.cmd' : 'tsx'

function step(label: string, args: string[], env: NodeJS.ProcessEnv = process.env) {
  console.log(`\n▶ ${label}`)
  const r = spawnSync('npx', [TSX, ...args], {
    stdio: 'inherit',
    env,
    shell: process.platform === 'win32',
  })
  if (r.status !== 0) {
    console.error(`✗ ${label} failed, the site was not started.`)
    process.exit(r.status ?? 1)
  }
}

async function isEmpty(): Promise<boolean> {
  const url = process.env.DATABASE_URL!
  const pool = new Pool({
    connectionString: url,
    ssl: sslFor(url),
    connectionTimeoutMillis: 15_000,
  })
  try {
    const { rows } = await pool.query<{ n: number }>('select count(*)::int as n from categories')
    return rows[0].n === 0
  } finally {
    await pool.end()
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('✗ DATABASE_URL is not set. Add it in Render, Environment.')
    process.exit(1)
  }

  step('Database tables', ['scripts/db-push.ts'])

  if (await isEmpty()) {
    /* The seed creates a starter admin that the staff step below turns into
       the support account, so it uses the same password. */
    const seedPassword = process.env.SEED_ADMIN_PASSWORD || process.env.STAFF_SUPPORT_PASSWORD
    if (!seedPassword) {
      console.error(
        '✗ New database, but no SEED_ADMIN_PASSWORD or STAFF_SUPPORT_PASSWORD to create the first admin with.',
      )
      process.exit(1)
    }
    step('Starting data (new database)', ['scripts/seed.ts'], {
      ...process.env,
      SEED_ADMIN_PASSWORD: seedPassword,
    })
  } else {
    console.log('\n▶ Starting data: the shop already has data, nothing changed.')
  }

  step('Admin accounts', ['scripts/staff.ts', '--if-configured'])
  console.log('\n✓ database ready, starting the site\n')
}

main().catch((err) => {
  console.error('✗ database preparation failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
