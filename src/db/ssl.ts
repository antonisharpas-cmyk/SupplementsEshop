/* ============================================================================
 * How to speak TLS to whichever Postgres is configured.
 *
 * Lives on its own because THREE things connect to the database — the app, the
 * migration script and the seed script — and they must agree. They did not:
 * `scripts/db-push.ts` built its own pool with no TLS at all, so against a
 * provider that requires encryption it failed before creating a single table,
 * while the app connected fine. One rule, imported everywhere.
 *
 * Deliberately free of other imports so a script can use it without pulling in
 * the schema or the driver.
 * ========================================================================== */

export type SslSetting = { rejectUnauthorized: boolean } | undefined

/**
 * A local socket needs no encryption. Every managed Postgres requires it, but
 * they do not all present a chain Node can verify against the system CA store
 * — Render is one that does not, and the failure reads
 * `SELF_SIGNED_CERT_IN_CHAIN`, which looks like a bug rather than a setting.
 *
 * So verification is on by default and is turned off deliberately with
 * DATABASE_SSL=no-verify. That still encrypts the connection; it only stops
 * Node checking who signed the certificate.
 *
 *   unset        localhost -> off, anything else -> encrypted and verified
 *   no-verify    encrypted, certificate signer not checked
 *   disable      no encryption (only sensible for a local socket)
 */
export function sslFor(connectionString: string): SslSetting {
  const mode = process.env.DATABASE_SSL?.trim().toLowerCase()
  const isLocal = /localhost|127\.0\.0\.1|\/var\/run|\[::1\]/.test(connectionString)

  if (mode === 'disable') return undefined
  if (mode === 'no-verify' || /sslmode=no-verify/.test(connectionString)) {
    return { rejectUnauthorized: false }
  }
  if (mode === 'require') return { rejectUnauthorized: true }
  if (!mode && isLocal) return undefined
  return { rejectUnauthorized: true }
}

/** Host and database only — safe to print. Never log the whole URL: it carries
 *  the password. */
export function describeConnection(connectionString: string): string {
  try {
    const url = new URL(connectionString)
    return `${url.hostname}${url.port ? ':' + url.port : ''}${url.pathname}`
  } catch {
    return '(unparseable DATABASE_URL)'
  }
}
