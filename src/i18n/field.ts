/* ============================================================================
 * Reading a translated database field.
 *
 * Lives in its own module with ZERO imports on purpose. It used to sit in
 * lib/catalog.ts, which imports the database — so the moment a client
 * component used it, Webpack pulled the `pg` driver into the browser bundle
 * and the build failed. Keeping it dependency-free makes the server/client
 * boundary impossible to cross by accident.
 * ========================================================================== */

/** Pick a locale from a JSONB translation map, falling back to English and
 *  then to whatever exists, so a missing translation never renders blank. */
export function tField(
  field: Record<string, string> | null | undefined,
  locale: string = 'en',
): string {
  if (!field) return ''
  return field[locale] || field.en || Object.values(field)[0] || ''
}
