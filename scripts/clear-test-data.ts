/* Clears everything that was only for testing, before the shop starts for real.

   On Render, in the AIONIX service's Shell tab:

     node dist-server/clear-test-data.mjs            shows what would be removed
     node dist-server/clear-test-data.mjs --yes      removes it

   Removed: orders, payments, invoices and credit notes (numbering starts again
   at 000001), shipments, carts, wishlists, test customer accounts, support
   chats, email history, purchases, suppliers, retailers, wholesale sales,
   expenses, stock movements, product costs, membership history, sessions
   (everyone signs in again).

   Kept: products, flavours and sizes, photos, categories, prices, promotions
   and codes, the homepage, delivery options, settings, email templates,
   newsletter and SMS subscribers, the audit log, the admin accounts and the
   shareholders' accounts (also when they registered as customers).

   Stock counts are kept as they are (correct them with the Opening stock
   sheet); add --zero-stock to set every product to 0 instead.

   With the database on the Render disk, this connects to it inside the
   running service (127.0.0.1, EMBEDDED_DB_PORT, 5433 by default). */

import './load-env'
import { sql } from 'drizzle-orm'
import { db, pool } from '../src/db'

/* People who keep their account whatever role it has today. */
const KEEP_EMAILS = ['info@ergonsite.com', 'andreasgeorgiou816@gmail.com', 'info@vs.supply', 'stavrosprokopiou93@gmail.com']

/* Test records, children before parents. */
const TABLES = [
  'attachments',
  'stock_movements',
  'variant_costs',
  'stock_value_snapshots',
  'purchase_lines',
  'purchases',
  'suppliers',
  'wholesale_payments',
  'wholesale_lines',
  'wholesale_prices',
  'invoices',
  'wholesale_sales',
  'retailers',
  'expenses',
  'recurring_expenses',
  'expense_categories',
  'shipments',
  'payments',
  'promo_code_usage',
  'order_items',
  'orders',
  'webhook_events',
  'inventory_reservations',
  'cart_items',
  'carts',
  'wishlist_items',
  'wishlists',
  'product_views',
  'stock_alerts',
  'support_messages',
  'support_conversations',
  'contact_requests',
  'email_jobs',
  'email_log',
  'tier_events',
  'newsletter_campaigns',
  'sms_campaigns',
  'otp_codes',
  'sessions',
]

async function main() {
  const yes = process.argv.includes('--yes')
  const zeroStock = process.argv.includes('--zero-stock')
  const count = async (q: ReturnType<typeof sql>) => Number(((await db.execute(q)).rows[0] as { n: number }).n)

  const keep = sql.join(KEEP_EMAILS.map((e) => sql`${e}`), sql`, `)
  console.log(yes ? '\nRemoving test data:\n' : '\nThis would remove (nothing changes without --yes):\n')
  for (const t of TABLES) {
    const n = await count(sql`select count(*)::int as n from ${sql.identifier(t)}`)
    if (n) console.log(`  ${t.padEnd(24)} ${n}`)
  }
  const customers = await count(sql`select count(*)::int as n from users where role = 'CUSTOMER' and lower(email) not in (${keep})`)
  console.log(`  ${'customer accounts'.padEnd(24)} ${customers}`)
  const files = await count(sql`select count(*)::int as n from media m where exists (select 1 from attachments a where a.media_id = m.id)`)
  if (files) console.log(`  ${'uploaded receipts'.padEnd(24)} ${files}`)
  console.log(`\n  Stock counts: ${zeroStock ? 'set to 0' : 'kept as they are'}`)

  if (!yes) {
    console.log('\nRun again with --yes to remove it.\n')
    await pool.end()
    return
  }

  await db.transaction(async (tx) => {
    /* The receipt files themselves, before their records go. */
    await tx.execute(sql`delete from media m where exists (select 1 from attachments a where a.media_id = m.id)`)
    await tx.execute(sql.raw(`truncate table ${TABLES.map((t) => `"${t}"`).join(', ')} restart identity`))
    /* Test customers, with their addresses and consents. */
    await tx.execute(sql`delete from addresses where user_id in (select id from users where role = 'CUSTOMER' and lower(email) not in (${keep}))`)
    await tx.execute(sql`delete from marketing_consents where user_id in (select id from users where role = 'CUSTOMER' and lower(email) not in (${keep}))`)
    await tx.execute(sql`delete from users where role = 'CUSTOMER' and lower(email) not in (${keep})`)
    /* Everyone left starts at Basic, with no membership history. */
    await tx.execute(sql`update users set tier = 'basic', tier_since = null, tier_expires_at = null, tier_manual_until = null, tier_checked_at = null`)
    await tx.execute(sql`update inventory set reserved = 0${zeroStock ? sql`, on_hand = 0` : sql``}, updated_at = now()`)
    await tx.execute(sql`delete from settings where key = 'books_closed_through'`)
  })
  console.log('\n✓ Test data removed. Invoice and purchase numbers start again from 1.')
  console.log('  Everyone is signed out and signs in again.\n')
  await pool.end()
}

main().catch((err) => {
  console.error('✗', err instanceof Error ? err.message : err)
  process.exitCode = 1
})
