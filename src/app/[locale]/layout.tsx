/* ============================================================================
 * Root layout for the storefront. It lives under [locale] rather than at the
 * app root so that <html lang> is correct for the page being served — which
 * matters for screen readers, for Google, and for CSS `:lang()` rules.
 *
 * Next 16: `params` is a Promise and must be awaited.
 * ========================================================================== */

import { notFound } from 'next/navigation'
import type { Metadata, Viewport } from 'next'
import { BRAND, LOCALES, isLocale, type Locale } from '@/config/brand'
import { assertSchemaReady } from '@/db/ready'
import { getCategoryTree } from '@/lib/catalog'
import { getCartCount, getOrCreateCart } from '@/lib/cart'
import { getCurrentUser, readCartToken } from '@/lib/auth/session'
import { wishlistProductIds } from '@/lib/wishlist'
import { WishlistProvider } from '@/components/WishlistProvider'
import { Footer, Header } from '@/components/Header'
import { SupportWidget } from '@/components/SupportWidget'

/* The brand is written in capitals everywhere, sentences included. */
const serviceBrand = BRAND.name
import '../globals.css'

export const viewport: Viewport = {
  themeColor: BRAND.theme.paper,
  colorScheme: 'dark',
}

/* Pre-render the three locale shells at build time. */
export function generateStaticParams() {
  return LOCALES.map((locale) => ({ locale }))
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>
}): Promise<Metadata> {
  const { locale } = await params
  const lang = isLocale(locale) ? locale : BRAND.market.defaultLocale

  return {
    title: {
      default: `${BRAND.name} | ${BRAND.tagline}`,
      template: `%s · ${BRAND.name}`,
    },
    description: BRAND.description,
    metadataBase: process.env.PUBLIC_SITE_URL
      ? new URL(process.env.PUBLIC_SITE_URL)
      : undefined,
    /* Canonical and language links are set per page: a site-wide one here
       would tell search engines every page is the home page. */
    openGraph: {
      type: 'website',
      siteName: BRAND.name,
      locale: lang === 'el' ? 'el_GR' : lang === 'ru' ? 'ru_RU' : 'en_GB',
    },
    robots: { index: true, follow: true },
  }
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ locale: string }>
}) {
  const { locale: raw } = await params
  if (!isLocale(raw)) notFound()
  const locale = raw as Locale

  /* Fail with the two commands to run, rather than with a page of SQL, when
     the database is connected but has no tables yet. */
  await assertSchemaReady()

  /* These three reads happen once per page render, in parallel. */
  const [categories, user, cartToken] = await Promise.all([
    getCategoryTree(),
    getCurrentUser(),
    readCartToken(),
  ])

  /* Only count an existing cart — do not create one just to render a zero,
     or every crawler visit would leave a row behind. */
  const savedIds = user ? await wishlistProductIds(user.id).catch(() => []) : []

  let cartCount = 0
  if (user || cartToken) {
    const cartId = await getOrCreateCart({
      userId: user?.id ?? null,
      anonymousToken: cartToken,
    }).catch(() => null)
    if (cartId) cartCount = await getCartCount(cartId)
  }

  return (
    <html lang={locale} className="bg-paper">
      <body className="flex min-h-screen flex-col">
        {/* Skip link — the first thing a keyboard user needs. */}
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:bg-accent focus:px-4 focus:py-2 focus:label focus:text-paper"
        >
          Skip to content
        </a>

        <Header
          locale={locale}
          categories={categories}
          cartCount={cartCount}
          signedIn={Boolean(user)}
        />

        <main id="main" className="flex-1">
          <WishlistProvider key={user?.id ?? "guest"} locale={locale} signedIn={Boolean(user)} initial={savedIds}>
            {children}
          </WishlistProvider>
        </main>

        <Footer locale={locale} />
        {/* Room below the footer on a phone, so the Customer Service button
            never sits on top of the last thing on the page. */}
        <div aria-hidden className="h-20 sm:hidden" />

        <SupportWidget locale={locale} brand={serviceBrand} />
      </body>
    </html>
  )
}
