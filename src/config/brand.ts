/* ============================================================================
 * THE ONLY FILE THAT KNOWS THE BRAND.
 *
 * Name, contact details, colours, social links. Everything else in the codebase
 * imports from here, so renaming the shop or changing its palette is an edit to
 * this file and nothing else.
 *
 * TODO: replace `legal` and `contact` with the real company details before
 * launch. Until then the site runs with placeholders rather than guesses.
 * ========================================================================== */

/* Added to logo links so a replaced logo shows at once, not an old cached copy. */
const ASSET_VERSION = (process.env.NEXT_PUBLIC_APP_VERSION ?? '1').slice(0, 12)

export const BRAND = {
  /** Shown in the header, page titles, emails and the footer. */
  name: 'AIONIX',
  /** Used in <title> as "Page · tagline". Keep it short. */
  tagline: 'Supplement Store',
  /** One line for search engines and link previews. */
  description:
    'Protein, creatine, pre workout, vitamins and more. Stocked in Cyprus and delivered island wide.',

  /** Logo files in public/brand. The mark is the "A" on its own. */
  logo: {
    mark: `/brand/aionix-mark.png?v=${ASSET_VERSION}`,
    wordmark: `/brand/aionix-wordmark.png?v=${ASSET_VERSION}`,
    full: `/brand/aionix-logo.png?v=${ASSET_VERSION}`,
  },

  /** Appears in the footer. Required of an EU online trader — see LAUNCH notes. */
  legal: {
    companyName: 'TODO Trading Ltd',
    registrationNumber: 'TODO',
    vatNumber: 'TODO',
  },

  contact: {
    email: 'info@aionixtest.com',
    phone: '+357 00 000000',
    whatsapp: '',
    addressLines: ['TODO Street 1', 'Larnaca', 'Cyprus'],
    /* Store pickup point shown at checkout and on the order page. */
    pickupName: 'AIONIX store, Larnaca',
    openingHours: 'Mon–Fri 10:00–19:00 · Sat 10:00–15:00',
  },

  social: {
    instagram: '',
    facebook: '',
    tiktok: '',
  },

  /* The AIONIX palette. src/app/globals.css carries the same values as CSS
     tokens; emails read them from here. */
  theme: {
    ink: '#E6E6E6', // primary text on dark backgrounds
    heading: '#FFFFFF', // headings
    paper: '#0B0B0B', // main background (Deep Black)
    card: '#1A1A1A', // cards and sections (Charcoal)
    line: '#2E2E2E', // borders and dividers (Graphite)
    muted: '#A7A7A7', // secondary text (Silver Grey)
    accent: '#FFD43B', // CTA buttons, highlights, accents (soft gold)
    accentInk: '#0B0B0B', // text on the yellow
    sale: '#FF4D3D',
  },

  /** Home market. Drives currency, default phone country code and delivery. */
  market: {
    country: 'CY',
    currency: 'EUR',
    locales: ['en', 'el', 'ru'] as const,
    defaultLocale: 'en' as const,
  },
} as const

export type Locale = (typeof BRAND.market.locales)[number]

export const LOCALES = BRAND.market.locales
export const DEFAULT_LOCALE = BRAND.market.defaultLocale

export const LOCALE_LABELS: Record<Locale, string> = {
  en: 'English',
  el: 'Ελληνικά',
  ru: 'Русский',
}

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}
