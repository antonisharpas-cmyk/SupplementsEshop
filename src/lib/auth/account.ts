/* ============================================================================
 * Account lifecycle: finish a verified registration, sign in, reset a password.
 *
 * Business rules enforced here and in the schema:
 *   1. no duplicate email                 (unique index on lower(email))
 *   2. no duplicate phone                 (unique index on phone)
 *   3. OTP verification required          (registration is only possible from a
 *                                          consumed OTP row's payload)
 *  16. admins never see a password        (nothing returns passwordHash)
 *  17. marketing consent explicitly logged (append-only consent table)
 * ========================================================================== */

import { and, eq, gt, sql } from 'drizzle-orm'
import { db } from '@/db'
import { addresses, marketingConsents, sessions, users, wishlists } from '@/db/schema'
import { isUniqueViolation } from '../db-errors'
import { fakeVerifyDelay, hashPassword, needsRehash, verifyPassword } from './password'
import { OtpError, verifyOtp } from './otp'
import { createSession, revokeAllSessionsForUser, type SessionUser } from './session'
import type { AddressInput } from '../validation'

export class AccountError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMAIL_TAKEN'
      | 'PHONE_TAKEN'
      | 'INVALID_CREDENTIALS'
      | 'ACCOUNT_DISABLED'
      | 'LOCKED_OUT'
      | 'WRONG_PASSWORD'
      | 'PENDING_PAYLOAD_MISSING',
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'AccountError'
  }
}

type PendingRegistration = {
  firstName: string
  lastName: string
  email: string
  phone: string
  passwordHash: string
  marketingConsent: boolean
  /* Missing on codes issued before SMS offers existed. */
  smsConsent?: boolean
  address: AddressInput | null
  locale: string
}

/* ----------------------------------------------------- finish registration -- */

/**
 * Step 4–5 of section 9: the code checks out, so create the account.
 *
 * Everything happens in one transaction — user, address, wishlist, consent
 * record. A half-created customer with no wishlist row is a bug that only
 * shows up later, on the wishlist page.
 */
export async function completeRegistration(
  email: string,
  code: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const verified = await verifyOtp(email, code, 'REGISTRATION')

  const pending = verified.pendingPayload as PendingRegistration | null
  if (!pending?.passwordHash) {
    throw new AccountError(
      'That registration could not be completed. Please sign up again.',
      'PENDING_PAYLOAD_MISSING',
    )
  }

  const userId = await db.transaction(async (tx) => {
    /* The unique indexes are the real guard — someone may have registered the
       same address in the ten minutes since the code was issued. We translate
       the constraint violation into a message a person can act on. */
    let created: { id: string }
    try {
      const rows = await tx
        .insert(users)
        .values({
          email: pending.email,
          phone: pending.phone,
          passwordHash: pending.passwordHash,
          firstName: pending.firstName,
          lastName: pending.lastName,
          role: 'CUSTOMER',
          emailVerifiedAt: new Date(),
          locale: ['en', 'el', 'ru'].includes(pending.locale) ? pending.locale : 'en',
        })
        .returning({ id: users.id })
      created = rows[0]
    } catch (err) {
      /* The constraint name is on the wrapped driver error, not on Drizzle's
         message — see src/lib/db-errors.ts. */
      if (isUniqueViolation(err, 'users_email_unique')) {
        throw new AccountError('This email address is already registered.', 'EMAIL_TAKEN')
      }
      if (isUniqueViolation(err, 'users_phone_unique')) {
        throw new AccountError('This phone number is already registered.', 'PHONE_TAKEN')
      }
      throw err
    }

    if (pending.address) {
      await tx.insert(addresses).values({
        userId: created.id,
        recipientName: `${pending.firstName} ${pending.lastName}`.trim(),
        phone: pending.phone,
        line1: pending.address.line1,
        line2: pending.address.line2 || null,
        city: pending.address.city,
        postalCode: pending.address.postalCode,
        country: pending.address.country,
        /* First address is the default — there is nothing to compete with. */
        isDefault: true,
      })
    }

    await tx.insert(wishlists).values({ userId: created.id }).onConflictDoNothing()

    /* Rule 17: record the answer either way, so "did they opt in?" has a
       provable answer rather than an absence of evidence. */
    await tx.insert(marketingConsents).values({
      email: pending.email,
      userId: created.id,
      granted: pending.marketingConsent,
      source: 'registration',
      ipHash: null,
    })

    return created.id
  })

  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1)
  const { token, expiresAt } = await createSession(userId, meta)

  /* Ticked "email me about new arrivals" — and the address was just proven by
     the one-time code, so this is a confirmed subscription. Unticked means
     nothing is added. A mailing-list hiccup never fails a registration. */
  if (pending.marketingConsent === true) {
    try {
      const { subscribeVerified, asLocale } = await import('@/lib/newsletter')
      await subscribeVerified({
        email: row.email,
        firstName: row.firstName,
        locale: asLocale(pending.locale),
        userId,
        source: 'registration',
        /* The account welcome below says it; one welcome, not two. */
        sendWelcome: false,
      })
    } catch (err) {
      console.error('[account] newsletter opt-in not recorded', err)
    }
  }

  /* Ticked "offers by SMS": the phone number is the one on the new account. */
  if (pending.smsConsent === true) {
    try {
      const { subscribeSms } = await import('@/lib/sms-marketing')
      await subscribeSms({ phone: row.phone, userId, firstName: row.firstName, locale: pending.locale, source: 'registration' })
    } catch (err) {
      console.error('[account] SMS opt-in not recorded', err)
    }
  }

  /* "Welcome to AIONIX" — queued, so it follows the automation's switch
     and shows in Email Activity. Never fails the registration. */
  try {
    const { scheduleWelcome } = await import('@/lib/automations')
    await scheduleWelcome(userId)
  } catch (err) {
    console.error('[account] welcome email not queued', err)
  }

  return {
    user: {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      role: row.role,
      emailVerifiedAt: row.emailVerifiedAt,
      financeAccess: row.financeAccess ?? false,
    },
    token,
    expiresAt,
  }
}

/* ------------------------------------------------------------------ login -- */

/* Lockout is per email+window and lives in memory. Good enough to blunt
   credential stuffing on a single instance; a multi-instance deployment should
   move this to Redis, which is noted in the README rather than pretended away. */
const LOGIN_WINDOW_MS = 15 * 60 * 1000
const LOGIN_MAX_FAILURES = 8
const failures = new Map<string, { count: number; resetAt: number }>()

function recordFailure(key: string) {
  const now = Date.now()
  const entry = failures.get(key)
  if (!entry || now > entry.resetAt) {
    /* Never wipe the whole table (that would let someone reset a target's
       lockout by flooding it with other names); drop only expired entries,
       then the oldest if it is still too big. */
    if (failures.size > 10_000) {
      for (const [k, v] of failures) if (now > v.resetAt) failures.delete(k)
      while (failures.size > 10_000) failures.delete(failures.keys().next().value!)
    }
    failures.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS })
    return
  }
  entry.count += 1
}

function assertNotLockedOut(key: string) {
  const entry = failures.get(key)
  if (!entry || Date.now() > entry.resetAt) return
  if (entry.count >= LOGIN_MAX_FAILURES) {
    throw new AccountError(
      'Too many failed sign-in attempts. Please try again later or reset your password.',
      'LOCKED_OUT',
      Math.ceil((entry.resetAt - Date.now()) / 1000),
    )
  }
}

function clearFailures(key: string) {
  failures.delete(key)
}

export function _resetLoginThrottleForTests() {
  failures.clear()
}

export async function login(
  email: string,
  password: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ user: SessionUser; token: string; expiresAt: Date }> {
  const key = email.toLowerCase()
  assertNotLockedOut(key)

  const [row] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${key}`)
    .limit(1)

  if (!row) {
    /* Spend the same time as a real check so timing does not reveal whether
       the address exists. */
    await fakeVerifyDelay()
    recordFailure(key)
    throw new AccountError('Email or password is incorrect.', 'INVALID_CREDENTIALS')
  }

  const ok = await verifyPassword(password, row.passwordHash)
  if (!ok) {
    recordFailure(key)
    throw new AccountError('Email or password is incorrect.', 'INVALID_CREDENTIALS')
  }

  if (!row.isActive) {
    throw new AccountError(
      'This account has been disabled. Please contact us.',
      'ACCOUNT_DISABLED',
    )
  }

  clearFailures(key)

  /* Opportunistic upgrade if the stored hash predates the current cost. */
  if (needsRehash(row.passwordHash)) {
    const upgraded = await hashPassword(password)
    await db.update(users).set({ passwordHash: upgraded }).where(eq(users.id, row.id))
  }

  const { token, expiresAt } = await createSession(row.id, meta)

  return {
    user: {
      id: row.id,
      email: row.email,
      firstName: row.firstName,
      lastName: row.lastName,
      phone: row.phone,
      role: row.role,
      emailVerifiedAt: row.emailVerifiedAt,
      financeAccess: row.financeAccess ?? false,
    },
    token,
    expiresAt,
  }
}

/* --------------------------------------------------------------- passwords -- */

/** The reset code, in the customer's language. */
export async function sendPasswordResetEmail(email: string, code: string, ttlSeconds: number) {
  const [user] = await db
    .select({ firstName: users.firstName, locale: users.locale })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1)
  const { sendTemplate } = await import('../mailer')
  return sendTemplate('auth_password_reset', {
    to: email,
    locale: user?.locale,
    vars: { code, minutes: Math.round(ttlSeconds / 60), customer_name: user?.firstName ?? '' },
  })
}

/** "Your password was changed" — the security notice after any change. */
async function notifyPasswordChanged(userId: string) {
  try {
    const [user] = await db
      .select({ email: users.email, firstName: users.firstName, locale: users.locale })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
    if (!user) return
    const { sendTemplate } = await import('../mailer')
    await sendTemplate('security_password_changed', { to: user.email, locale: user.locale, vars: { customer_name: user.firstName } })
  } catch (err) {
    console.error('[account] password-changed notice not sent', err)
  }
}

export async function changePassword(
  userId: string,
  currentPassword: string,
  newPassword: string,
  keepToken?: string,
) {
  const [row] = await db
    .select({ passwordHash: users.passwordHash })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) {
    throw new AccountError('Your current password is not correct.', 'WRONG_PASSWORD')
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, userId))

  /* Anyone who had a stolen session loses it. The current browser keeps
     working, so the customer is not logged out of the page they are on. */
  const revoked = await revokeAllSessionsForUser(userId, keepToken)
  await notifyPasswordChanged(userId)
  return { otherSessionsRevoked: revoked }
}

export async function resetPasswordWithOtp(email: string, code: string, newPassword: string) {
  await verifyOtp(email, code, 'PASSWORD_RESET')

  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1)

  if (!row) {
    /* The OTP was valid, so this can only happen if the account was deleted in
       between. Same generic message; no enumeration. */
    throw new OtpError('That code is no longer valid. Request a new one.', 'NOT_FOUND')
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(newPassword) })
    .where(eq(users.id, row.id))

  const revoked = await revokeAllSessionsForUser(row.id)
  clearFailures(email.toLowerCase())
  await notifyPasswordChanged(row.id)
  return { sessionsRevoked: revoked }
}

/* ------------------------------------------------------------------ admin -- */

/**
 * Section 29: an admin may trigger a reset but never see the password. This
 * returns nothing secret — the code goes to the customer's inbox only.
 */
export async function adminTriggerPasswordReset(customerId: string) {
  const [row] = await db
    .select({ email: users.email })
    .from(users)
    /* Customers only: an admin account's password is changed by its owner. */
    .where(and(eq(users.id, customerId), eq(users.role, 'CUSTOMER')))
    .limit(1)
  if (!row) return null

  const { issuePasswordResetOtp } = await import('./otp')
  const { OTP_TTL_SECONDS } = await import('./otp')

  const issued = await issuePasswordResetOtp(row.email)
  if (!issued) return null
  await sendPasswordResetEmail(row.email, issued.code, OTP_TTL_SECONDS)
  return { email: row.email }
}

/* ----------------------------------------------------------------- profile -- */

export async function updateProfile(
  userId: string,
  patch: { firstName?: string; lastName?: string; phone?: string },
) {
  if (patch.phone) {
    /* Rule 2 again: changing a phone number must not collide either. */
    const [clash] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.phone, patch.phone), sql`${users.id} <> ${userId}`))
      .limit(1)
    if (clash) {
      throw new AccountError('This phone number is already registered.', 'PHONE_TAKEN')
    }
  }

  try {
    await db.update(users).set(patch).where(eq(users.id, userId))
  } catch (err) {
    if (isUniqueViolation(err, 'users_phone_unique')) {
      throw new AccountError('This phone number is already registered.', 'PHONE_TAKEN')
    }
    throw err
  }
}

export async function listActiveSessions(userId: string) {
  return db
    .select({
      id: sessions.id,
      userAgent: sessions.userAgent,
      createdAt: sessions.createdAt,
      expiresAt: sessions.expiresAt,
    })
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        sql`${sessions.revokedAt} is null`,
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .orderBy(sql`${sessions.createdAt} desc`)
}

/** Record consent given somewhere other than registration (checkout, footer,
 *  account settings). Append-only, so the history is auditable. */
export async function recordMarketingConsent(args: {
  email: string
  userId?: string | null
  granted: boolean
  source: 'registration' | 'checkout' | 'footer' | 'account'
  ipHash?: string | null
}) {
  await db.insert(marketingConsents).values({
    email: args.email,
    userId: args.userId ?? null,
    granted: args.granted,
    source: args.source,
    ipHash: args.ipHash ?? null,
  })
}

/** Latest stated preference for an address. */
export async function hasMarketingConsent(email: string): Promise<boolean> {
  const [row] = await db
    .select({ granted: marketingConsents.granted })
    .from(marketingConsents)
    .where(sql`lower(${marketingConsents.email}) = ${email.toLowerCase()}`)
    .orderBy(sql`${marketingConsents.createdAt} desc`)
    .limit(1)
  return row?.granted ?? false
}
