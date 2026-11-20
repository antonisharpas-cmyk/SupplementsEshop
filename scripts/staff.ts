/* Sets up the two admin accounts from the Render environment, the same way
   as our other sites:

     SUPPORT_EMAIL, SUPPORT_PASSWORD   ErgonSite support: super admin
     ADMIN_EMAIL,   ADMIN_PASSWORD     the shop owners: admin, full access
                                       including costs, profit and finance

   Runs at every start and is safe to run again:
   · A missing account is created with the password from the environment.
   · The password from the environment is applied the first time, and again
     whenever it is changed in Render. If it stays the same, a password the
     person changed in Admin, Change password is kept. --reset applies it now.
   · The starter account admin@example.com becomes the support account.
   · An admin can never reset or switch off another staff account, so the
     owners cannot change the support password.

   Older key names still work: STAFF_SUPPORT_PASSWORD for SUPPORT_PASSWORD.
   Passwords live only in the environment, never in this file. */

import './load-env'
import { createHash } from 'node:crypto'
import { eq, sql } from 'drizzle-orm'
import { db, pool } from '../src/db'
import { settings, users } from '../src/db/schema'
import { hashPassword } from '../src/lib/auth/password'
import { revokeAllSessionsForUser } from '../src/lib/auth/session'

type Staff = { email: string; password: string; firstName: string; lastName: string; role: 'SUPER_ADMIN' | 'ADMIN'; finance: boolean; phone: string }

const env = (k: string) => process.env[k]?.trim() || ''

/* A fingerprint of the environment password, to notice when it is changed in
   Render. Salted, never the password itself. */
const fingerprint = (s: Staff) => createHash('sha256').update(`aionix-staff:${s.email}:${s.password}:${env('JWT_SECRET')}`).digest('hex')
const fpKey = (s: Staff) => `staff_env:${s.email}`
async function envChanged(s: Staff) {
  const [row] = await db.select().from(settings).where(eq(settings.key, fpKey(s)))
  return row?.value !== fingerprint(s)
}
async function remember(s: Staff) {
  await db
    .insert(settings)
    .values({ key: fpKey(s), value: fingerprint(s), description: 'Admin account password from Render, fingerprint only' })
    .onConflictDoUpdate({ target: settings.key, set: { value: fingerprint(s), updatedAt: new Date() } })
}

function configured(): Staff[] {
  const out: Staff[] = []
  const supportEmail = (env('SUPPORT_EMAIL') || 'info@ergonsite.com').toLowerCase()
  const supportPassword = env('SUPPORT_PASSWORD') || env('STAFF_SUPPORT_PASSWORD')
  if (supportPassword) {
    out.push({ email: supportEmail, password: supportPassword, firstName: 'Support', lastName: 'ErgonSite', role: 'SUPER_ADMIN', finance: true, phone: '+35700000100' })
  }
  const adminEmail = env('ADMIN_EMAIL').toLowerCase()
  const adminPassword = env('ADMIN_PASSWORD')
  if (adminEmail && adminPassword && adminEmail !== supportEmail) {
    out.push({ email: adminEmail, password: adminPassword, firstName: 'AIONIX', lastName: 'Admin', role: 'ADMIN', finance: true, phone: '+35700000101' })
  }
  return out
}

async function main() {
  const reset = process.argv.includes('--reset')
  const staff = configured()
  if (staff.length === 0) {
    if (process.argv.includes('--if-configured')) return
    throw new Error('Set SUPPORT_PASSWORD (and ADMIN_EMAIL with ADMIN_PASSWORD) first.')
  }
  for (const s of staff) {
    if (Buffer.byteLength(s.password) < 10) throw new Error(`The password for ${s.email} must be at least 10 characters.`)
  }

  for (const s of staff) {
    let [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${s.email}`)
    let setPassword = reset || (await envChanged(s))

    /* The starter admin from a new database becomes the support account. */
    if (!existing && s.role === 'SUPER_ADMIN') {
      const [starter] = await db.select().from(users).where(sql`lower(${users.email}) = 'admin@example.com'`)
      if (starter) {
        await db.update(users).set({ email: s.email, updatedAt: new Date() }).where(eq(users.id, starter.id))
        console.log(`  admin@example.com renamed to ${s.email}`)
        existing = { ...starter, email: s.email }
        setPassword = true
      }
    }

    if (!existing) {
      /* The phone must be unique; a placeholder is used, staff do not shop. */
      let phone = s.phone
      for (let i = 0; (await db.select({ id: users.id }).from(users).where(eq(users.phone, phone))).length; i++) phone = `${s.phone}${i}`
      await db.insert(users).values({
        email: s.email,
        phone,
        passwordHash: await hashPassword(s.password),
        firstName: s.firstName,
        lastName: s.lastName,
        role: s.role,
        financeAccess: s.finance,
        emailVerifiedAt: new Date(),
        isActive: true,
      })
      await remember(s)
      console.log(`  created  ${s.email} (${s.role === 'SUPER_ADMIN' ? 'support, super admin' : 'admin, full access'})`)
      continue
    }

    await db
      .update(users)
      .set({
        role: s.role,
        financeAccess: s.finance,
        isActive: true,
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        ...(setPassword ? { passwordHash: await hashPassword(s.password) } : {}),
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id))
    if (setPassword) {
      await revokeAllSessionsForUser(existing.id)
      await remember(s)
    }
    console.log(`  ready    ${s.email}${setPassword ? ', password set from the environment' : ', password kept'}`)
  }
  console.log('\n✓ admin accounts ready. Each person changes their own password in Admin, Change password.\n')
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err)
    process.exitCode = 1
  })
  .finally(() => pool.end())
