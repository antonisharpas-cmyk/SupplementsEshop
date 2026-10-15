/* ============================================================================
 * Authentication tests — spec section 45.
 *
 * Against real Postgres, because the guarantees being tested (duplicate email,
 * duplicate phone, one-use OTP under concurrent submission) are enforced by
 * unique indexes and row locks, not by TypeScript.
 * ========================================================================== */

import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { db, pool } from '@/db'
import { SINGLE_ENGINE_REASON, isSingleEngineDatabase } from '@/db/engine'
import { marketingConsents, otpCodes, sessions, users, wishlists } from '@/db/schema'
import { normalisePhone, registerSchema } from '@/lib/validation'
import {
  OTP_MAX_ATTEMPTS,
  OtpError,
  issuePasswordResetOtp,
  issueRegistrationOtp,
  verifyOtp,
} from '../otp'
import {
  AccountError,
  _resetLoginThrottleForTests,
  changePassword,
  completeRegistration,
  hasMarketingConsent,
  login,
  resetPasswordWithOtp,
  updateProfile,
} from '../account'
import { hashPassword, needsRehash, verifyPassword } from '../password'
import { getUserByToken, revokeAllSessionsForUser } from '../session'

/* Asked once, at collection time, so the skip appears in the report rather
   than the test hanging and taking the whole run's connection with it. */
const SERIALISED = await isSingleEngineDatabase()

const BASE = {
  firstName: 'Elena',
  lastName: 'Georgiou',
  email: 'elena@example.com',
  phone: '+35799123456',
  password: 'correct horse battery',
  marketingConsent: false,
  locale: 'en' as const,
}

async function wipe() {
  await db.delete(marketingConsents)
  await db.delete(sessions)
  await db.delete(wishlists)
  await db.delete(otpCodes)
  await db.delete(users)
  _resetLoginThrottleForTests()
}

/** Registers and verifies in one step, returning the session token. */
async function register(overrides: Partial<typeof BASE> = {}) {
  const input = registerSchema.parse({ ...BASE, ...overrides })
  const code = (await issueRegistrationOtp(input)).code!
  return completeRegistration(input.email, code!)
}

beforeEach(wipe)
afterAll(async () => {
  await pool.end()
})

/* ========================================================================== */

describe('phone normalisation', () => {
  it('reduces every spelling of one Cypriot number to the same value', () => {
    const forms = [
      '+357 99 123456',
      '+35799123456',
      '0035799123456',
      '99123456',
      '99 12 34 56',
      '(99) 123-456',
    ]
    const normalised = forms.map(normalisePhone)
    expect(new Set(normalised).size).toBe(1)
    expect(normalised[0]).toBe('+35799123456')
  })

  it('keeps a foreign country code as given', () => {
    expect(normalisePhone('+44 7700 900123')).toBe('+447700900123')
  })

  it('rejects what is not a phone number', () => {
    expect(normalisePhone('')).toBeNull()
    expect(normalisePhone('abc')).toBeNull()
    expect(normalisePhone('12345')).toBeNull()
  })
})

/* ========================================================================== */

describe('password hashing', () => {
  it('never stores the password and verifies correctly', async () => {
    const hash = await hashPassword('correct horse battery')
    expect(hash).not.toContain('correct')
    expect(await verifyPassword('correct horse battery', hash)).toBe(true)
    expect(await verifyPassword('wrong horse battery', hash)).toBe(false)
  })

  it('produces a different hash each time (salted)', async () => {
    const a = await hashPassword('correct horse battery')
    const b = await hashPassword('correct horse battery')
    expect(a).not.toBe(b)
  })

  it('treats a malformed stored hash as a failed login, not a crash', async () => {
    expect(await verifyPassword('anything', 'not-a-hash')).toBe(false)
  })

  it('flags a weak-cost hash for upgrade', () => {
    expect(needsRehash('$2a$04$abcdefghijklmnopqrstuv')).toBe(true)
    expect(needsRehash('$2a$12$abcdefghijklmnopqrstuv')).toBe(false)
  })

  it('refuses a password bcrypt would silently truncate', async () => {
    await expect(hashPassword('x'.repeat(100))).rejects.toThrow(/72 bytes/)
  })
})

/* ========================================================================== */

describe('registration requires a verified code', () => {
  it('creates no user until the code is verified', async () => {
    const input = registerSchema.parse(BASE)
    await issueRegistrationOtp(input)

    /* Section 9: the account must not exist yet. */
    const before = await db.select().from(users)
    expect(before).toHaveLength(0)

    const [otp] = await db.select().from(otpCodes)
    expect(otp.purpose).toBe('REGISTRATION')
    /* The code itself must not be readable from the row. */
    expect(otp.codeHash).toHaveLength(64)
  })

  it('creates the user, wishlist and consent record once verified', async () => {
    const { user, token } = await register()

    expect(user.email).toBe('elena@example.com')
    expect(user.emailVerifiedAt).toBeInstanceOf(Date)
    expect(user.role).toBe('CUSTOMER')

    const resolved = await getUserByToken(token)
    expect(resolved?.id).toBe(user.id)

    const lists = await db.select().from(wishlists).where(eq(wishlists.userId, user.id))
    expect(lists).toHaveLength(1)

    const consents = await db.select().from(marketingConsents)
    expect(consents).toHaveLength(1)
    expect(consents[0].granted).toBe(false)
  })

  it('never stores the plaintext password, even on the pending OTP row', async () => {
    const input = registerSchema.parse(BASE)
    await issueRegistrationOtp(input)
    const [otp] = await db.select().from(otpCodes)
    expect(JSON.stringify(otp.pendingPayload)).not.toContain('correct horse battery')
  })

  it('records an explicit opt-in when given', async () => {
    await register({ email: 'optin@example.com', phone: '99123457', marketingConsent: true })
    expect(await hasMarketingConsent('optin@example.com')).toBe(true)
  })
})

/* ========================================================================== */

describe('duplicate accounts are refused', () => {
  /* Anti-enumeration: a registered address is not refused out loud. It gets
     the same answer a new one does, an email telling the owner, and an OTP
     row that no code can ever complete. */
  const pastCooldown = () =>
    db.update(otpCodes).set({ createdAt: new Date(Date.now() - 5 * 60_000) })

  it('does not create a second account for the same email — and does not say so', async () => {
    await register()
    await pastCooldown()
    const again = await issueRegistrationOtp(registerSchema.parse({ ...BASE, phone: '99000001' }))
    expect(again.code).toBeNull()
    expect(again.existingAccount?.firstName).toBe(BASE.firstName)
    expect(again.expiresAt).toBeInstanceOf(Date)
    /* No six-digit code opens the decoy. */
    await expect(completeRegistration(BASE.email, '123456')).rejects.toBeTruthy()
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('treats the same email in different case as the same account', async () => {
    await register()
    await pastCooldown()
    const again = await issueRegistrationOtp(
      registerSchema.parse({ ...BASE, email: 'ELENA@Example.COM', phone: '99000002' }),
    )
    expect(again.code).toBeNull()
    expect(again.existingAccount).toBeDefined()
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('refuses a second registration with the same phone in another format', async () => {
    await register()
    await expect(
      issueRegistrationOtp(
        registerSchema.parse({ ...BASE, email: 'other@example.com', phone: '+357 99 12 34 56' }),
      ),
    ).rejects.toMatchObject({ code: 'PHONE_TAKEN' })
  })

  /* Skipped on the embedded development database, which runs one engine and
     would deadlock rather than race — see src/db/engine.ts. */
  it.skipIf(SERIALISED)(`refuses at the database level when two verifications race${
    SERIALISED ? ` — skipped: ${SINGLE_ENGINE_REASON}` : ''
  }`, async () => {
    /* Both registrations pass the availability check because neither account
       exists yet; only the unique index can decide the winner. */
    const a = registerSchema.parse({ ...BASE, email: 'race-a@example.com', phone: '99000010' })
    const b = registerSchema.parse({ ...BASE, email: 'race-b@example.com', phone: '99000010' })

    const codeA = (await issueRegistrationOtp(a)).code
    const codeB = (await issueRegistrationOtp(b)).code

    const results = await Promise.allSettled([
      completeRegistration(a.email, codeA!),
      completeRegistration(b.email, codeB!),
    ])

    const ok = results.filter((r) => r.status === 'fulfilled')
    const failed = results.filter((r) => r.status === 'rejected')

    expect(ok).toHaveLength(1)
    expect(failed).toHaveLength(1)
    expect((failed[0] as PromiseRejectedResult).reason).toBeInstanceOf(AccountError)
    expect((failed[0] as PromiseRejectedResult).reason.code).toBe('PHONE_TAKEN')

    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('refuses changing a phone number to one already registered', async () => {
    const first = await register()
    await register({ email: 'second@example.com', phone: '99000003' })

    await expect(updateProfile(first.user.id, { phone: '+35799000003' })).rejects.toMatchObject({
      code: 'PHONE_TAKEN',
    })
  })
})

/* ========================================================================== */

describe('OTP codes expire and limit attempts', () => {
  it('rejects a wrong code and counts the attempt', async () => {
    const input = registerSchema.parse(BASE)
    await issueRegistrationOtp(input)

    await expect(verifyOtp(input.email, '000000', 'REGISTRATION')).rejects.toBeInstanceOf(OtpError)

    const [row] = await db.select().from(otpCodes)
    expect(row.attempts).toBe(1)
    expect(row.consumedAt).toBeNull()
  })

  it('locks the code after the attempt limit', async () => {
    const input = registerSchema.parse(BASE)
    const code = (await issueRegistrationOtp(input)).code!

    for (let i = 0; i < OTP_MAX_ATTEMPTS; i++) {
      await expect(verifyOtp(input.email, '000000', 'REGISTRATION')).rejects.toBeInstanceOf(OtpError)
    }

    /* Even the correct code is now dead — the attempts are spent. */
    await expect(verifyOtp(input.email, code, 'REGISTRATION')).rejects.toMatchObject({
      code: 'TOO_MANY_ATTEMPTS',
    })
  })

  it('rejects an expired code', async () => {
    const input = registerSchema.parse(BASE)
    const code = (await issueRegistrationOtp(input)).code!

    await db.update(otpCodes).set({ expiresAt: new Date(Date.now() - 1000) })

    await expect(verifyOtp(input.email, code, 'REGISTRATION')).rejects.toMatchObject({
      code: 'EXPIRED',
    })
  })

  it('allows a code to be used once only', async () => {
    const input = registerSchema.parse(BASE)
    const code = (await issueRegistrationOtp(input)).code!

    await completeRegistration(input.email, code)

    await expect(completeRegistration(input.email, code)).rejects.toBeInstanceOf(OtpError)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('cannot be consumed twice by two simultaneous submissions', async () => {
    const input = registerSchema.parse({ ...BASE, email: 'once@example.com', phone: '99000020' })
    const code = (await issueRegistrationOtp(input)).code!

    const results = await Promise.allSettled([
      completeRegistration(input.email, code),
      completeRegistration(input.email, code),
    ])

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await db.select().from(users)).toHaveLength(1)
  })

  it('invalidates an older code when a new one is issued', async () => {
    const input = registerSchema.parse(BASE)
    const first = await issueRegistrationOtp(input)

    /* Sidestep the resend cooldown — we are testing supersession, not throttling. */
    await db.update(otpCodes).set({ createdAt: new Date(Date.now() - 120_000) })
    const second = await issueRegistrationOtp(input)

    await expect(verifyOtp(input.email, first.code!, 'REGISTRATION')).rejects.toBeInstanceOf(OtpError)
    const ok = await verifyOtp(input.email, second.code!, 'REGISTRATION')
    expect(ok.email).toBe(input.email)
  })

  it('throttles repeated code requests for the same address', async () => {
    const input = registerSchema.parse(BASE)
    await issueRegistrationOtp(input)

    /* Immediately again — the cooldown should bite. */
    await expect(issueRegistrationOtp(input)).rejects.toMatchObject({ code: 'COOLDOWN' })
  })
})

/* ========================================================================== */

describe('sign in', () => {
  it('accepts the right password and issues a working session', async () => {
    await register()
    const { user, token } = await login('elena@example.com', 'correct horse battery')
    expect(user.email).toBe('elena@example.com')
    expect((await getUserByToken(token))?.id).toBe(user.id)
  })

  it('is case-insensitive on the email', async () => {
    await register()
    const { user } = await login('ELENA@EXAMPLE.COM', 'correct horse battery')
    expect(user.email).toBe('elena@example.com')
  })

  it('gives the same message for a wrong password and an unknown address', async () => {
    await register()

    const wrongPassword = await login('elena@example.com', 'nope nope nope').catch((e) => e)
    const unknownEmail = await login('nobody@example.com', 'nope nope nope').catch((e) => e)

    expect(wrongPassword.message).toBe(unknownEmail.message)
    expect(wrongPassword.code).toBe('INVALID_CREDENTIALS')
    expect(unknownEmail.code).toBe('INVALID_CREDENTIALS')
  })

  it('locks out after repeated failures', async () => {
    await register()
    for (let i = 0; i < 8; i++) {
      await login('elena@example.com', 'wrong wrong wrong').catch(() => {})
    }
    await expect(login('elena@example.com', 'correct horse battery')).rejects.toMatchObject({
      code: 'LOCKED_OUT',
    })
  })

  it('refuses a disabled account even with the right password', async () => {
    const { user } = await register()
    await db.update(users).set({ isActive: false }).where(eq(users.id, user.id))

    await expect(login('elena@example.com', 'correct horse battery')).rejects.toMatchObject({
      code: 'ACCOUNT_DISABLED',
    })
  })

  it('stops a revoked session from resolving', async () => {
    const { user, token } = await register()
    expect(await getUserByToken(token)).not.toBeNull()

    await revokeAllSessionsForUser(user.id)
    expect(await getUserByToken(token)).toBeNull()
  })
})

/* ========================================================================== */

describe('password changes and resets', () => {
  it('requires the current password and signs other devices out', async () => {
    const { user, token } = await register()
    const other = await login('elena@example.com', 'correct horse battery')

    await expect(changePassword(user.id, 'wrong', 'a brand new password')).rejects.toMatchObject({
      code: 'WRONG_PASSWORD',
    })

    const { otherSessionsRevoked } = await changePassword(
      user.id,
      'correct horse battery',
      'a brand new password',
      token,
    )
    expect(otherSessionsRevoked).toBeGreaterThanOrEqual(1)

    /* The browser that made the change keeps working; the other does not. */
    expect(await getUserByToken(token)).not.toBeNull()
    expect(await getUserByToken(other.token)).toBeNull()

    _resetLoginThrottleForTests()
    await expect(login('elena@example.com', 'a brand new password')).resolves.toBeTruthy()
  })

  it('resets with an OTP and invalidates every old session', async () => {
    const { token } = await register()

    const issued = await issuePasswordResetOtp('elena@example.com')
    expect(issued).not.toBeNull()

    await resetPasswordWithOtp('elena@example.com', issued!.code, 'yet another password')

    expect(await getUserByToken(token)).toBeNull()
    await expect(login('elena@example.com', 'yet another password')).resolves.toBeTruthy()
  })

  it('does not reveal whether an address is registered', async () => {
    /* Returns null rather than throwing, so the route can answer identically
       either way. */
    expect(await issuePasswordResetOtp('nobody@example.com')).toBeNull()
  })
})

/* ========================================================================== */

describe('validation rejects bad input before it reaches the database', () => {
  it('refuses a short password', () => {
    const result = registerSchema.safeParse({ ...BASE, password: 'short' })
    expect(result.success).toBe(false)
  })

  it('refuses a malformed email', () => {
    const result = registerSchema.safeParse({ ...BASE, email: 'not-an-email' })
    expect(result.success).toBe(false)
  })

  it('refuses an unusable phone number', () => {
    const result = registerSchema.safeParse({ ...BASE, phone: '123' })
    expect(result.success).toBe(false)
  })

  it('strips control characters from names', () => {
    const parsed = registerSchema.parse({ ...BASE, firstName: 'El\u0000ena\u001F' })
    expect(parsed.firstName).toBe('Elena')
  })
})
