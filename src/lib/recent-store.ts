/* ============================================================================
 * The device's own "recently viewed" list.
 *
 * Browser-only, and deliberately so: a visitor who has not signed in and has
 * not put anything in their bag has no identity on the server, and inventing a
 * tracking cookie so a four-item strip can work is a bad trade. The list of
 * product ids lives on the device; the server only ever prices the ids it is
 * handed.
 *
 * Every access is wrapped: storage throws in private mode, in embedded
 * webviews, and whenever a browser has site data blocked. Losing the strip is
 * fine; throwing on a product page is not.
 * ========================================================================== */

const KEY = 'sf_recent_products'
const MAX = 12

export function rememberProduct(productId: string): void {
  try {
    const current = readRecentProducts().filter((id) => id !== productId)
    const next = [productId, ...current].slice(0, MAX)
    window.localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* No storage, no history. Nothing else breaks. */
  }
}

export function readRecentProducts(): string[] {
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    /* Trust nothing that comes back out of storage — another tab, an older
       version of this code, or a person with devtools could have written it. */
    return parsed.filter((v): v is string => typeof v === 'string' && UUID.test(v)).slice(0, MAX)
  } catch {
    return []
  }
}

export function forgetRecentProducts(): void {
  try {
    window.localStorage.removeItem(KEY)
  } catch {
    /* nothing to do */
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
