/* ============================================================================
 * "Why won't it connect?" — one command that answers it.
 *
 *     npm run db:check
 *
 * Reports, in order: whether DATABASE_URL is set and parseable, which host it
 * points at, whether TLS negotiated, whether the tables exist, and whether
 * there is any data in them. Each step either passes or explains the fix.
 *
 * Never prints the password. Everything shown here is safe to paste into a
 * chat or an issue.
 * ========================================================================== */

import './load-env'

import { Pool } from 'pg'
import { describeConnection, sslFor } from '../src/db/ssl'

const EXPECTED_TABLES = [
  'categories',
  'products',
  'product_variants',
  'inventory',
  'inventory_reservations',
  'carts',
  'cart_items',
  'users',
  'orders',
  'settings',
]

function ok(label: string, detail = '') {
  console.log(`  ✓ ${label}${detail ? ' — ' + detail : ''}`)
}
function bad(label: string, detail = '') {
  console.log(`  ✗ ${label}${detail ? ' — ' + detail : ''}`)
}
function hint(lines: string[]) {
  console.log('')
  for (const line of lines) console.log(`    ${line}`)
  console.log('')
}

async function main() {
  console.log('\nDatabase check\n')

  /* --- 1. is it configured at all? --- */
  const url = process.env.DATABASE_URL
  if (!url) {
    bad('DATABASE_URL is not set')
    hint([
      'Create .env.local in this folder with one line:',
      '',
      '    DATABASE_URL="postgresql://user:pass@host/dbname"',
      '',
      'On Windows, write it with:',
      '    Set-Content -Path .env.local -Value \'DATABASE_URL="..."\' -Encoding ascii',
      '(PowerShell\'s default encoding adds a hidden marker that breaks the file.)',
    ])
    process.exitCode = 1
    return
  }
  ok('DATABASE_URL is set')

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    bad('DATABASE_URL is not a valid URL')
    hint([
      'It must look like:  postgresql://user:password@host:5432/dbname',
      'Common causes: missing quotes in .env.local, a line break in the middle,',
      'or a stray character from copy-paste.',
    ])
    process.exitCode = 1
    return
  }

  if (!/^postgres(ql)?:$/.test(parsed.protocol)) {
    bad(`unexpected scheme "${parsed.protocol}"`, 'expected postgresql://')
    process.exitCode = 1
    return
  }
  ok('target', describeConnection(url))

  /* A local socket often needs no password; a hosted database always has one. */
  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/.test(parsed.hostname)
  if (!parsed.password && !isLocal) {
    bad('no password in the URL', 'Render and Neon both include one — check you copied all of it')
  }

  /* Render's internal hostname does not resolve from your own machine. */
  if (/^dpg-[a-z0-9-]+$/.test(parsed.hostname)) {
    bad('that is Render\'s INTERNAL hostname')
    hint([
      'Use the "External Database URL" from the Render dashboard instead.',
      'Its host has the region in it, e.g.',
      '    dpg-xxxxxxxx-a.frankfurt-postgres.render.com',
    ])
    process.exitCode = 1
    return
  }

  const ssl = sslFor(url)
  ok(
    'TLS',
    ssl === undefined
      ? 'off (local socket)'
      : ssl.rejectUnauthorized
        ? 'on, certificate verified'
        : 'on, certificate not verified (DATABASE_SSL=no-verify)',
  )

  /* --- 2. can we connect? --- */
  const pool = new Pool({ connectionString: url, ssl, connectionTimeoutMillis: 15_000, max: 1 })

  try {
    const { rows } = await pool.query<{ version: string; db: string; user: string }>(
      'select version() as version, current_database() as db, current_user as user',
    )
    ok('connected', `${rows[0].db} as ${rows[0].user}`)
    ok('server', rows[0].version.split(' ').slice(0, 2).join(' '))
  } catch (err) {
    const e = err as { message?: string; code?: string }
    bad('could not connect', e.message)

    if (e.code === 'SELF_SIGNED_CERT_IN_CHAIN' || /self.signed certificate/i.test(e.message ?? '')) {
      hint([
        'The provider\'s certificate is not signed by a CA Node trusts.',
        'Add this line to .env.local and run this again:',
        '',
        '    DATABASE_SSL=no-verify',
      ])
    } else if (/no encryption|SSL.*required|server does not support SSL/i.test(e.message ?? '')) {
      hint(['That server requires TLS. Add DATABASE_SSL=require to .env.local.'])
    } else if (e.code === 'ENOTFOUND') {
      hint([
        'That hostname does not resolve. Check it against the dashboard —',
        'on Render, use the External Database URL.',
      ])
    } else if (e.code === 'ETIMEDOUT' || /timeout/i.test(e.message ?? '')) {
      hint([
        'The host did not answer in time. Either the database is asleep or',
        'suspended (check the dashboard), or something between you and it is',
        'blocking port 5432 — a corporate network or VPN often does.',
      ])
    } else if (e.code === 'ECONNREFUSED') {
      hint(['Nothing is listening there. Is the database running?'])
    } else if (/password authentication failed/i.test(e.message ?? '')) {
      hint(['The password is wrong. Copy the connection string again in full.'])
    } else if (/does not exist/i.test(e.message ?? '')) {
      hint(['The user or database in the URL does not exist on that server.'])
    }

    await pool.end()
    process.exitCode = 1
    return
  }

  /* --- 3. is the schema there? --- */
  const { rows: tableRows } = await pool.query<{ table_name: string }>(
    `select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'`,
  )
  const present = new Set(tableRows.map((r) => r.table_name))
  const missing = EXPECTED_TABLES.filter((t) => !present.has(t))

  if (present.size === 0) {
    bad('the database is empty', 'no tables at all')
    hint(['Create the schema and the demo data:', '', '    npm run db:push', '    npm run db:seed'])
    await pool.end()
    process.exitCode = 1
    return
  }

  if (missing.length) {
    bad(`${missing.length} expected table(s) missing`, missing.join(', '))
    hint(['Finish the migration:', '', '    npm run db:push'])
    await pool.end()
    process.exitCode = 1
    return
  }
  ok('schema', `${present.size} tables`)

  /* --- 4. is there anything in it? --- */
  const counts = await pool.query<{ categories: string; products: string; variants: string }>(
    `select
       (select count(*) from categories) as categories,
       (select count(*) from products) as products,
       (select count(*) from product_variants) as variants`,
  )
  const c = counts.rows[0]

  if (Number(c.products) === 0) {
    bad('no products', 'the tables exist but are empty')
    hint(['Load the demo catalogue:', '', '    npm run db:seed'])
    await pool.end()
    process.exitCode = 1
    return
  }

  ok('data', `${c.categories} categories, ${c.products} products, ${c.variants} variants`)

  console.log('\n✓ the database is ready. Run: npm run dev\n')
  await pool.end()
}

main().catch((err) => {
  console.error('\n✗ the check itself failed:', err)
  process.exitCode = 1
})
