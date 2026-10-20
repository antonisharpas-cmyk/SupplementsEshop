/* Sets up the admin accounts.

     npm run staff -- --support-password "…" --shareholder-password "…"

   · Support (ErgonSite) is the super admin. The old starter account
     admin@example.com becomes it, if it is still there.
   · Each shareholder gets an admin account with the same access.
   · Safe to run again: existing accounts keep their password (each person
     changes their own in Admin, My account) unless --reset is given.

   Passwords are passed on the command line, never written in this file,
   so they do not end up in git. Run it while `npm run dev` is running
   (it uses the same database). */

import './load-env'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import { users } from '../src/db/schema'
import { hashPassword } from '../src/lib/auth/password'
import { revokeAllSessionsForUser } from '../src/lib/auth/session'

type Staff = { email: string; firstName: string; lastName: string; role: 'SUPER_ADMIN' | 'ADMIN'; phone: string; kind: 'support' | 'shareholder' }

const STAFF: Staff[] = [
  { email: 'info@ergonsite.com', firstName: 'Support', lastName: 'ErgonSite', role: 'SUPER_ADMIN', phone: '+35700000100', kind: 'support' },
  { email: 'andreasgeorgiou816@gmail.com', firstName: 'Andreas', lastName: 'Georgiou', role: 'ADMIN', phone: '+35700000101', kind: 'shareholder' },
  { email: 'info@vs.supply', firstName: 'VS', lastName: 'Supply', role: 'ADMIN', phone: '+35700000102', kind: 'shareholder' },
  { email: 'stavrosprokopiou93@gmail.com', firstName: 'Stavros', lastName: 'Prokopiou', role: 'ADMIN', phone: '+35700000103', kind: 'shareholder' },
]

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : undefined
}

async function main() {
  const supportPassword = arg('support-password')
  const shareholderPassword = arg('shareholder-password')
  const reset = process.argv.includes('--reset')
  for (const [n, p] of [['support-password', supportPassword], ['shareholder-password', shareholderPassword]] as const) {
    if (!p || Buffer.byteLength(p) < 10) throw new Error(`--${n} is required, at least 10 characters.`)
  }

  /* The starter admin becomes the support account. */
  const [starter] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = 'admin@example.com'`)
  const [support] = await db.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = 'info@ergonsite.com'`)
  if (starter && !support) {
    await db.update(users).set({ email: 'info@ergonsite.com', updatedAt: new Date() }).where(eq(users.id, starter.id))
    console.log('  admin@example.com renamed to info@ergonsite.com')
  }

  for (const s of STAFF) {
    const password = s.kind === 'support' ? supportPassword! : shareholderPassword!
    const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${s.email.toLowerCase()}`)
    if (!existing) {
      /* The phone must be unique; a placeholder is used, staff do not shop. */
      let phone = s.phone
      for (let i = 0; (await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))).length; i++) phone = `${s.phone}${i}`
      await db.insert(users).values({
        email: s.email,
        phone,
        passwordHash: await hashPassword(password),
        firstName: s.firstName,
        lastName: s.lastName,
        role: s.role,
        emailVerifiedAt: new Date(),
        isActive: true,
      })
      console.log(`  created  ${s.email} (${s.role === 'SUPER_ADMIN' ? 'support, super admin' : 'admin'})`)
      continue
    }
    const changePassword = reset || (s.kind === 'support' && starter?.id === existing.id && !support)
    await db
      .update(users)
      .set({
        role: s.role,
        isActive: true,
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        ...(s.kind === 'support' ? { firstName: s.firstName, lastName: s.lastName } : {}),
        ...(changePassword ? { passwordHash: await hashPassword(password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
    if (changePassword) await revokeAllSessionsForUser(existing.id)
    console.log(`  updated  ${s.email}${changePassword ? ', password set' : ', password kept'}`)
  }
  console.log('\n✓ staff accounts ready. Each person changes their own password in Admin, My account.\n')
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
