/* ============================================================================
 * Database client.
 *
 * Uses the standard `pg` driver rather than a serverless HTTP driver on
 * purpose: the inventory reservation logic needs real transactions with
 * SELECT … FOR UPDATE, and HTTP-mode drivers only do single statements.
 * Neon's pooled connection string works with this driver.
 * ========================================================================== */

import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from './schema'
import { sslFor } from './ssl'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. For local development the committed .env.development ' +
      'supplies one; otherwise copy .env.example to .env.local and fill it in ' +
      '(see README → Running it).',
  )
}

/* Next.js dev mode re-evaluates modules on every hot reload. Without this the
   pool count climbs until Postgres refuses new connections. */
const globalForDb = globalThis as unknown as { __pool?: Pool }

export const pool =
  globalForDb.__pool ??
  new Pool({
    connectionString,
    max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    /* One rule, shared with the migration and seed scripts. */
    ssl: sslFor(connectionString),
  })

if (process.env.NODE_ENV !== 'production') globalForDb.__pool = pool

export const db = drizzle(pool, { schema })

export type Db = typeof db

/** A transaction handle, for functions that must run inside one. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0]

export { schema }
