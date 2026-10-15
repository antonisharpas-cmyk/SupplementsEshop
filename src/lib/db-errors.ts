/* ============================================================================
 * Reading Postgres errors reliably.
 *
 * Drizzle wraps driver errors in its own Error whose message is "Failed query:
 * …", so `err.message.includes('users_email_unique')` does NOT work — the
 * constraint name lives on the wrapped cause, not the wrapper. Matching on
 * message text would also break the moment a Postgres version reworded
 * something.
 *
 * So: walk the cause chain and read the structured SQLSTATE fields.
 * ========================================================================== */

/** Fields node-postgres puts on a DatabaseError. */
export type PgErrorLike = {
  code?: string
  constraint?: string
  detail?: string
  table?: string
  column?: string
}

const SQLSTATE = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  SERIALIZATION_FAILURE: '40001',
  DEADLOCK_DETECTED: '40P01',
  LOCK_NOT_AVAILABLE: '55P03',
} as const

/** Finds the driver error inside however many layers have wrapped it. */
export function pgError(err: unknown): PgErrorLike | null {
  let current: unknown = err
  for (let depth = 0; depth < 8 && current; depth++) {
    if (typeof current === 'object' && current !== null) {
      const candidate = current as PgErrorLike & { cause?: unknown }
      if (typeof candidate.code === 'string' && /^[0-9A-Z]{5}$/.test(candidate.code)) {
        return candidate
      }
      current = candidate.cause
      continue
    }
    break
  }
  return null
}

/** The name of the unique index that was violated, or null. */
export function uniqueViolation(err: unknown): string | null {
  const pg = pgError(err)
  if (pg?.code !== SQLSTATE.UNIQUE_VIOLATION) return null
  return pg.constraint ?? 'unknown'
}

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const name = uniqueViolation(err)
  if (name === null) return false
  return constraint ? name === constraint : true
}

export function checkViolation(err: unknown): string | null {
  const pg = pgError(err)
  if (pg?.code !== SQLSTATE.CHECK_VIOLATION) return null
  return pg.constraint ?? 'unknown'
}

export function isCheckViolation(err: unknown, constraint?: string): boolean {
  const name = checkViolation(err)
  if (name === null) return false
  return constraint ? name === constraint : true
}

export function isForeignKeyViolation(err: unknown): boolean {
  return pgError(err)?.code === SQLSTATE.FOREIGN_KEY_VIOLATION
}

/**
 * True for errors worth retrying: a deadlock or serialisation failure means
 * Postgres aborted one transaction to break a tie, and the same work will
 * usually succeed on a second attempt.
 */
export function isRetryable(err: unknown): boolean {
  const code = pgError(err)?.code
  return (
    code === SQLSTATE.SERIALIZATION_FAILURE ||
    code === SQLSTATE.DEADLOCK_DETECTED ||
    code === SQLSTATE.LOCK_NOT_AVAILABLE
  )
}

/** Retries a transaction a couple of times when Postgres asks us to. */
export async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      if (!isRetryable(err) || i === attempts - 1) throw err
      /* Small jittered backoff so two retrying transactions do not collide
         again on the same tick. */
      await new Promise((r) => setTimeout(r, 15 * (i + 1) + Math.random() * 20))
    }
  }
  throw lastError
}

export { SQLSTATE }
