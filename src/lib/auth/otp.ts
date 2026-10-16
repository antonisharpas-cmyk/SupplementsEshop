/* ============================================================================
 * OTP — email verification codes. Spec sections 9 and 33.
 *
 * Requirements being met here:
 *   · a code is required before an account exists (section 9)
 *   · codes expire            (section 33)
 *   · codes have limited attempts (section 33)
 *   · the endpoint is rate-limited (section 33)
 *   · duplicate email / phone is refused (business rules 1, 2)
 *
 * Two decisions worth stating:
 *
 * 1. The registration payload is held ON the OTP row, not in a half-created
 *    user record. An unverified signup therefore creates no user at all, so it
 *    cannot occupy the email address or appear in the admin customer list.
 *
 * 2. Codes are stored hashed. A code is a short-lived password; an admin
 *    reading the table, or a database backup leaking, must not hand over the
 *    ability to verify someone else's address.
 * ========================================================================== */

import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { otpCodes, users } from '@/db/schema'
import type { RegisterInput } from '../validation'

export const OTP_TTL_SECONDS = 10 * 60
export const OTP_MAX_ATTEMPTS = 5
/** No more than this many codes per address per window, so the endpoint cannot
 *  be used to spam somebody's inbox. */
export const OTP_MAX_SENDS_PER_HOUR = 5
/** A new code cannot be requested within this many seconds of the last one. */
export const OTP_RESEND_COOLDOWN_SECONDS = 60

export type OtpPurpose = 'REGISTRATION' | 'PASSWORD_RESET' | 'EMAIL_CHANGE'

export class OtpError extends Error {
  constructor(
    message: string,
    readonly code:
      | 'EMAIL_TAKEN'
      | 'PHONE_TAKEN'
      | 'RATE_LIMITED'
      | 'COOLDOWN'
      | 'NOT_FOUND'
      | 'EXPIRED'
      | 'TOO_MANY_ATTEMPTS'
      | 'INVALID_CODE',
    readonly retryAfterSeconds?: number,
  ) {
    super(message)
    this.name = 'OtpError'
  }
}

const hashCode = (code: string) => createHash('sha256').update(code).digest('hex')

/** Six digits, uniform, from a CSPRNG. Math.random() is not acceptable for
 *  anything that grants access. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8')
  const bufB = Buffer.from(b, 'utf8')
  if (bufA.length !== bufB.length) return false
  return timingSafeEqual(bufA, bufB)
}

/* -------------------------------------------------------- duplicate checks -- */

/**
 * Business rules 1 and 2. Checked here for a good error message, and enforced
 * again by unique indexes at insert time — two simultaneous registrations
 * cannot both pass this check, so the index is what actually guarantees it.
 */
export async function assertIdentityAvailable(email: string, phone: string) {
  const clashes = await db
    .select({ email: users.email, phone: users.phone })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()} OR ${users.phone} = ${phone}`)
    .limit(2)

  for (const row of clashes) {
    if (row.email.toLowerCase() === email.toLowerCase()) {
      throw new OtpError('This email address is already registered.', 'EMAIL_TAKEN')
    }
  }
  if (clashes.length > 0) {
    throw new OtpError('This phone number is already registered.', 'PHONE_TAKEN')
  }
}

/* ------------------------------------------------------------------ issue --- */

async function assertSendAllowed(email: string, purpose: OtpPurpose) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000)

  const [recent] = await db
    .select({
      sends: sql<number>`count(*)`.mapWith(Number),
      latest: sql<Date | null>`max(${otpCodes.createdAt})`,
    })
    .from(otpCodes)
    .where(
      and(
        sql`lower(${otpCodes.email}) = ${email.toLowerCase()}`,
        eq(otpCodes.purpose, purpose),
        gt(otpCodes.createdAt, hourAgo),
      ),
    )

  if (recent && recent.sends >= OTP_MAX_SENDS_PER_HOUR) {
    throw new OtpError(
      'Too many verification codes requested. Please try again in an hour.',
      'RATE_LIMITED',
      60 * 60,
    )
  }

  if (recent?.latest) {
    const since = (Date.now() - new Date(recent.latest).getTime()) / 1000
    if (since < OTP_RESEND_COOLDOWN_SECONDS) {
      const wait = Math.ceil(OTP_RESEND_COOLDOWN_SECONDS - since)
      throw new OtpError(
        `Please wait ${wait} second${wait === 1 ? '' : 's'} before requesting another code.`,
        'COOLDOWN',
        wait,
      )
    }
  }
}

/**
 * Issue a registration code. Returns the plaintext code so the caller can mail
 * it — it is never returned to the browser and never logged in production.
 *
 * An email that already has an account gets NO code and no error either: the
 * answer to the browser is the same "check your inbox", and the address's
 * owner is emailed "you already have an account — sign in" instead
 * (`existingAccount` tells the caller which email to send). So the form
 * cannot be used to find out who shops here. The same limits, the same
 * password hashing, and an OTP row of the same shape (whose code can never
 * match) keep the two paths indistinguishable from outside, in timing too.
 *
 * A phone number already on another account is still refused openly: the
 * person has to change what they typed, and a phone number alone does not
 * identify an email address.
 */
export async function issueRegistrationOtp(input: RegisterInput): Promise<{
  code: string | null
  expiresAt: Date
  existingAccount?: { firstName: string; locale: string }
}> {
  const [existing] = await db
    .select({ firstName: users.firstName, locale: users.locale, phone: users.phone })
    .from(users)
    .where(sql`lower(${users.email}) = ${input.email.toLowerCase()}`)
    .limit(1)
  if (!existing) await assertIdentityAvailable(input.email, input.phone)
  await assertSendAllowed(input.email, 'REGISTRATION')

  const code = existing ? null : generateCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000)

  /* Supersede any outstanding code for this address so only the newest works —
     otherwise five requested codes are five live chances to brute force. */
  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        sql`lower(${otpCodes.email}) = ${input.email.toLowerCase()}`,
        eq(otpCodes.purpose, 'REGISTRATION'),
        isNull(otpCodes.consumedAt),
      ),
    )

  /* The password is hashed before it is parked on the OTP row — a pending
     registration must not store a plaintext password even briefly. (Hashed
     for an existing address too, and thrown away: same time either way.) */
  const { hashPassword } = await import('./password')
  const passwordHash = await hashPassword(input.password)

  await db.insert(otpCodes).values({
    email: input.email,
    purpose: 'REGISTRATION',
    /* For an existing address: the hash of 32 random bytes, which no
       six-digit code can ever match. */
    codeHash: hashCode(code ?? randomBytes(32).toString('hex')),
    maxAttempts: OTP_MAX_ATTEMPTS,
    expiresAt,
    pendingPayload: existing
      ? null
      : {
          firstName: input.firstName,
          lastName: input.lastName,
          email: input.email,
          phone: input.phone,
          passwordHash,
          marketingConsent: input.marketingConsent,
          smsConsent: input.smsConsent,
          address: input.address ?? null,
          locale: input.locale,
        },
  })

  return existing
    ? { code: null, expiresAt, existingAccount: { firstName: existing.firstName, locale: existing.locale } }
    : { code: code!, expiresAt }
}

export async function issuePasswordResetOtp(
  email: string,
): Promise<{ code: string; expiresAt: Date } | null> {
  await assertSendAllowed(email, 'PASSWORD_RESET')

  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(sql`lower(${users.email}) = ${email.toLowerCase()}`)
    .limit(1)

  /* Deliberately returns null rather than throwing: the caller responds
     identically whether or not the address exists, so the reset form cannot be
     used to enumerate customers. */
  if (!user) return null

  const code = generateCode()
  const expiresAt = new Date(Date.now() + OTP_TTL_SECONDS * 1000)

  await db
    .update(otpCodes)
    .set({ consumedAt: new Date() })
    .where(
      and(
        sql`lower(${otpCodes.email}) = ${email.toLowerCase()}`,
        eq(otpCodes.purpose, 'PASSWORD_RESET'),
        isNull(otpCodes.consumedAt),
      ),
    )

  await db.insert(otpCodes).values({
    email,
    purpose: 'PASSWORD_RESET',
    codeHash: hashCode(code),
    maxAttempts: OTP_MAX_ATTEMPTS,
    expiresAt,
  })

  return { code, expiresAt }
}

/* ----------------------------------------------------------------- verify --- */

export type VerifiedOtp = {
  id: string
  email: string
  pendingPayload: Record<string, unknown> | null
}

/**
 * Check a code and consume it. One code, one use.
 *
 * The attempt counter is incremented for a wrong code *before* returning, so a
 * brute-force attempt burns through its five tries rather than guessing freely.
 */
/**
 * Check a code and consume it. One code, one use.
 *
 * IMPORTANT — why this is not one big transaction:
 *
 * The attempt counter must be incremented when a code is WRONG. If the
 * increment and the rejection lived in the same transaction, throwing would
 * roll the increment back and an attacker would get unlimited guesses. That
 * was a real bug here, caught by the "counts the attempt" test.
 *
 * So the transaction returns a verdict instead of throwing. The write commits,
 * and the error is raised afterwards.
 */
export async function verifyOtp(
  email: string,
  code: string,
  purpose: OtpPurpose,
): Promise<VerifiedOtp> {
  type Verdict =
    | { kind: 'ok'; row: VerifiedOtp }
    | { kind: 'not_found' }
    | { kind: 'expired' }
    | { kind: 'too_many' }
    | { kind: 'wrong'; attemptsLeft: number }

  const verdict = await db.transaction(async (tx): Promise<Verdict> => {
    /* Lock the row: two simultaneous submissions of the same code must not
       both succeed, and must not both increment attempts from the same value. */
    const [row] = await tx
      .select()
      .from(otpCodes)
      .where(
        and(
          sql`lower(${otpCodes.email}) = ${email.toLowerCase()}`,
          eq(otpCodes.purpose, purpose),
          isNull(otpCodes.consumedAt),
        ),
      )
      .orderBy(desc(otpCodes.createdAt))
      .limit(1)
      .for('update')

    if (!row) return { kind: 'not_found' }

    if (row.expiresAt.getTime() < Date.now()) {
      await tx.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id))
      return { kind: 'expired' }
    }

    if (row.attempts >= row.maxAttempts) {
      await tx.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id))
      return { kind: 'too_many' }
    }

    if (!constantTimeEquals(hashCode(code), row.codeHash)) {
      const attempts = row.attempts + 1
      await tx.update(otpCodes).set({ attempts }).where(eq(otpCodes.id, row.id))
      /* The row is left unconsumed even when the attempts are now spent, so the
         NEXT call hits the `attempts >= maxAttempts` branch above and the person
         is told why the code stopped working, rather than a generic "no longer
         valid" that reads as if we lost their code. That branch burns it. */
      return { kind: 'wrong', attemptsLeft: row.maxAttempts - attempts }
    }

    await tx.update(otpCodes).set({ consumedAt: new Date() }).where(eq(otpCodes.id, row.id))

    return {
      kind: 'ok',
      row: {
        id: row.id,
        email: row.email,
        pendingPayload: (row.pendingPayload as Record<string, unknown> | null) ?? null,
      },
    }
  })

  /* Committed. Now it is safe to reject. */
  switch (verdict.kind) {
    case 'ok':
      return verdict.row
    case 'not_found':
      throw new OtpError('That code is no longer valid. Request a new one.', 'NOT_FOUND')
    case 'expired':
      throw new OtpError('That code has expired. Request a new one.', 'EXPIRED')
    case 'too_many':
      throw new OtpError('Too many incorrect attempts. Request a new code.', 'TOO_MANY_ATTEMPTS')
    case 'wrong': {
      const left = verdict.attemptsLeft
      throw new OtpError(
        left > 0
          ? `That code is not right. ${left} attempt${left === 1 ? '' : 's'} left.`
          : 'Too many incorrect attempts. Request a new code.',
        left > 0 ? 'INVALID_CODE' : 'TOO_MANY_ATTEMPTS',
      )
    }
  }
}

/** Housekeeping: consumed and long-expired codes have no further use. */
export async function purgeStaleOtps(olderThanHours = 24): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanHours * 60 * 60 * 1000)
  const rows = await db
    .delete(otpCodes)
    .where(sql`${otpCodes.createdAt} < ${cutoff}`)
    .returning({ id: otpCodes.id })
  return rows.length
}
