/* Applies migrations, then the hand-written invariants in constraints.sql.
   Always run together: a migration that adds a table without its CHECK
   constraints leaves a window where bad data can land. */
import './load-env'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { Pool } from 'pg'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { describeConnection, sslFor } from '../src/db/ssl'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  console.error('✗ DATABASE_URL is not set. Put it in .env.local (see .env.example).')
  process.exit(1)
}

/* Same TLS rule as the app. This script used to build a plain pool, which
   failed on any provider that requires encryption. */
const pool = new Pool({
  connectionString,
  ssl: sslFor(connectionString),
  connectionTimeoutMillis: 15_000,
})

async function main() {
  const db = drizzle(pool)
  console.log(`→ connecting to ${describeConnection(connectionString!)}`)
  await pool.query('select 1')
  console.log('→ applying migrations')
  await migrate(db, { migrationsFolder: './drizzle' })

  console.log('→ applying constraints.sql')
  const sql = readFileSync(join(process.cwd(), 'src/db/constraints.sql'), 'utf8')
  await pool.query(sql)

  console.log('✓ schema is up to date')
}

main()
  .catch((err: unknown) => {
    const e = err as { message?: string; code?: string }
    console.error('✗ schema push failed:', e.message ?? err)

    /* The three failures that actually happen, with the fix rather than a
       stack trace. */
    if (e.code === 'SELF_SIGNED_CERT_IN_CHAIN' || /self.signed certificate/i.test(e.message ?? '')) {
      console.error(
        '\n  The provider\'s certificate is not signed by a CA Node trusts.\n' +
          '  Add this line to .env.local and run it again:\n\n' +
          '      DATABASE_SSL=no-verify\n',
      )
    } else if (/no encryption|SSL.*required|server does not support SSL/i.test(e.message ?? '')) {
      console.error('\n  That server requires TLS. Add DATABASE_SSL=require to .env.local.\n')
    } else if (e.code === 'ENOTFOUND' || e.code === 'ETIMEDOUT') {
      console.error(
        '\n  That host did not answer. On Render, use the EXTERNAL Database URL —\n' +
          '  the internal one only resolves from inside Render.\n',
      )
    }

    process.exitCode = 1
  })
  .finally(() => pool.end())
