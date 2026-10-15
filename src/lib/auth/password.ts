/* ============================================================================
 * Password hashing.
 *
 * bcrypt via bcryptjs — pure JavaScript, so it needs no native build step and
 * runs identically on a laptop, in CI and on a serverless host. argon2id is a
 * stronger primitive, but its Node bindings are native and the prebuilt
 * binaries are a deployment liability; bcrypt at cost 12 is well past the bar
 * for a retail storefront.
 *
 * Business rule 16: an admin must never be able to see a customer's password.
 * Nothing in this module can reverse a hash, and the admin panel exposes only
 * `triggerPasswordReset`, never the hash itself.
 * ========================================================================== */

import bcrypt from 'bcryptjs'

/* ~250ms per hash on typical server hardware. High enough to make offline
   cracking expensive, low enough that a login does not feel slow. */
const COST = 12

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 8) {
    throw new Error('Refusing to hash a password shorter than 8 characters.')
  }
  /* bcrypt silently truncates at 72 bytes. Pre-hashing would avoid that, but it
     changes the stored format; rejecting is clearer than silently ignoring the
     tail of a long passphrase. Validation caps input at 200 chars, so we
     reject here rather than truncate. */
  if (Buffer.byteLength(plain, 'utf8') > 72) {
    throw new PasswordTooLongError()
  }
  return bcrypt.hash(plain, COST)
}

export class PasswordTooLongError extends Error {
  constructor() {
    super('Passwords longer than 72 bytes are not supported. Please use a shorter one.')
    this.name = 'PasswordTooLongError'
  }
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  if (!plain || !hash) return false
  if (Buffer.byteLength(plain, 'utf8') > 72) return false
  try {
    return await bcrypt.compare(plain, hash)
  } catch {
    /* A malformed hash in the database must read as "wrong password", never as
       an exception that leaks a stack trace to the login form. */
    return false
  }
}

/**
 * Spend the same time as a real verification when the email does not exist.
 * Without this, response timing tells an attacker which addresses are
 * registered — which is also a customer-privacy leak, not just a security one.
 */
export async function fakeVerifyDelay(): Promise<void> {
  await bcrypt.compare(
    'timing-equalisation',
    '$2a$12$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ012345',
  ).catch(() => false)
}

/** True when a stored hash was made with a weaker cost and should be upgraded
 *  on next successful login. */
export function needsRehash(hash: string): boolean {
  const match = /^\$2[aby]\$(\d{2})\$/.exec(hash)
  if (!match) return true
  return Number(match[1]) < COST
}
