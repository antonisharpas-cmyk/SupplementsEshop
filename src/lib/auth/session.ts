/* ============================================================================
 * Sessions.
 *
 * Opaque random tokens in an httpOnly cookie, with only the SHA-256 stored.
 * Chosen over a self-contained JWT because a storefront needs to be able to
 * revoke a session immediately — "log out everywhere", an admin disabling an
 * account, a password change. A stateless JWT cannot be revoked before it
 * expires without keeping a deny-list, which is a session table with extra
 * steps.
 *
 * The cost is one indexed lookup per authenticated request, which is cheap
 * next to the queries a product page already makes.
 * ========================================================================== */

import { createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'
import { and, eq, gt, isNull, sql } from 'drizzle-orm'
import { db } from '@/db'
import { sessions, users, type User, type UserRole } from '@/db/schema'

export const SESSION_COOKIE = 'sf_session'
export const SESSION_TTL_DAYS = 30
/** Anonymous cart identity, so a guest keeps their basket across a refresh. */
export const CART_COOKIE = 'sf_cart'

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

export type SessionUser = {
  id: string
  email: string
  firstName: string
  lastName: string
  phone: string
  role: UserRole
  emailVerifiedAt: Date | null
}

function toSessionUser(u: User): SessionUser {
  return {
    id: u.id,
    email: u.email,
    firstName: u.firstName,
    lastName: u.lastName,
    phone: u.phone,
    role: u.role,
    emailVerifiedAt: u.emailVerifiedAt,
  }
}

/* ----------------------------------------------------------------- create -- */

export async function createSession(
  userId: string,
  meta: { userAgent?: string | null; ip?: string | null } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url')
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000)

  await db.insert(sessions).values({
    userId,
    tokenHash: hashToken(token),
    userAgent: meta.userAgent?.slice(0, 400) ?? null,
    /* The IP is hashed: useful for spotting abuse, but storing raw addresses
       for 30 days is personal data we do not need. */
    ipHash: meta.ip ? createHash('sha256').update(meta.ip).digest('hex') : null,
    expiresAt,
  })

  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, userId))

  return { token, expiresAt }
}

export async function setSessionCookie(token: string, expiresAt: Date) {
  const jar = await cookies()
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    /* Lax rather than Strict: the Stripe redirect back into the site is a
       cross-site navigation, and Strict would drop the session on arrival. */
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires: expiresAt,
  })
}

export async function clearSessionCookie() {
  const jar = await cookies()
  jar.delete(SESSION_COOKIE)
}

/* ------------------------------------------------------------------- read -- */

/** Resolve the current user, or null. Safe to call on every request. */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (!token) return null
  return getUserByToken(token)
}

/** Same lookup, for contexts without the cookie store (middleware, tests). */
export async function getUserByToken(token: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.isActive, true),
      ),
    )
    .limit(1)

  return row ? toSessionUser(row.user) : null
}

/* ---------------------------------------------------------------- require -- */

export class AuthError extends Error {
  constructor(
    message: string,
    readonly code: 'UNAUTHENTICATED' | 'FORBIDDEN' | 'UNVERIFIED',
    readonly status: number,
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new AuthError('Your session has expired. Please sign in again.', 'UNAUTHENTICATED', 401)
  return user
}

const ADMIN_ROLES: UserRole[] = ['ADMIN', 'SUPER_ADMIN']

/** Spec section 40: role-based access, structured so more roles can be added. */
export async function requireAdmin(minimum: UserRole = 'ADMIN'): Promise<SessionUser> {
  const user = await requireUser()
  if (!ADMIN_ROLES.includes(user.role)) {
    /* Deliberately the same message a signed-out visitor gets: an admin route
       should not confirm its own existence to a logged-in customer. */
    throw new AuthError('Not found.', 'FORBIDDEN', 404)
  }
  if (minimum === 'SUPER_ADMIN' && user.role !== 'SUPER_ADMIN') {
    throw new AuthError('This action needs a super-admin account.', 'FORBIDDEN', 403)
  }
  return user
}

/* --------------------------------------------------------------- lifecycle -- */

export async function revokeSessionByToken(token: string) {
  await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(eq(sessions.tokenHash, hashToken(token)))
}

export async function revokeCurrentSession() {
  const jar = await cookies()
  const token = jar.get(SESSION_COOKIE)?.value
  if (token) await revokeSessionByToken(token)
  jar.delete(SESSION_COOKIE)
}

/** Used after a password change, and by the admin "sign this customer out
 *  everywhere" action. */
export async function revokeAllSessionsForUser(userId: string, except?: string) {
  const conditions = [eq(sessions.userId, userId), isNull(sessions.revokedAt)]
  if (except) conditions.push(sql`${sessions.tokenHash} <> ${hashToken(except)}`)
  const rows = await db
    .update(sessions)
    .set({ revokedAt: new Date() })
    .where(and(...conditions))
    .returning({ id: sessions.id })
  return rows.length
}

export async function purgeExpiredSessions(): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(sql`${sessions.expiresAt} < now() - interval '7 days'`)
    .returning({ id: sessions.id })
  return rows.length
}

/* ------------------------------------------------------------ anon carts --- */

/** Stable per-browser token so a guest keeps their cart — and therefore their
 *  stock reservations — across page loads. */
export async function getOrCreateCartToken(): Promise<string> {
  const jar = await cookies()
  const existing = jar.get(CART_COOKIE)?.value
  if (existing) return existing

  const token = randomBytes(24).toString('base64url')
  jar.set(CART_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 60,
  })
  return token
}

export async function readCartToken(): Promise<string | null> {
  const jar = await cookies()
  return jar.get(CART_COOKIE)?.value ?? null
}
