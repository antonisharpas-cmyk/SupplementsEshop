/* The product page's flavour and size buttons and its photo gallery talk
   through one browser event: choosing a flavour (or a size) brings that
   flavour's photos to the front. */

export const VARIANT_EVENT = 'pdp:variant'

export type VariantChoice = { flavour: string; variantId: string | null }

/** The key a flavour is grouped by: its English name, or its colour when it
 *  has no name. Two sizes of one flavour share it. */
export function flavourKey(v: { colorName: Record<string, string> | null; colorHex: string | null }): string {
  return v.colorName?.en?.trim().toLowerCase() || v.colorHex || ''
}

export function announceVariant(choice: VariantChoice) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<VariantChoice>(VARIANT_EVENT, { detail: choice }))
}
