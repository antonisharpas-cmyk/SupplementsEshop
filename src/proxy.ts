/* ============================================================================
 * Locale routing. Called `proxy` rather than `middleware` because Next.js 16
 * renamed the convention — see node_modules/next/dist/docs, "middleware to
 * proxy".
 *
 * Job: make sure every storefront URL carries a locale prefix, choosing the
 * visitor's language from their own Accept-Language header on first visit and
 * remembering it afterwards.
 * ========================================================================== */

import { NextResponse, type NextRequest } from 'next/server'
import { DEFAULT_LOCALE, LOCALES, isLocale } from '@/config/brand'

const LOCALE_COOKIE = 'sf_locale'

/** Best match between what the browser asked for and what the shop speaks. */
function negotiateLocale(request: NextRequest): string {
  /* An explicit earlier choice wins over the browser's header. */
  const saved = request.cookies.get(LOCALE_COOKIE)?.value
  if (saved && isLocale(saved)) return saved

  const header = request.headers.get('accept-language')
  if (!header) return DEFAULT_LOCALE

  /* Parse "el-GR,el;q=0.9,en;q=0.8" into an ordered list of language tags. */
  const ranked = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';')
      const q = params.find((p) => p.trim().startsWith('q='))
      return { tag: tag.toLowerCase(), q: q ? Number(q.split('=')[1]) || 0 : 1 }
    })
    .sort((a, b) => b.q - a.q)

  for (const { tag } of ranked) {
    const base = tag.split('-')[0]
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const hasLocale = LOCALES.some(
    (locale) => pathname === `/${locale}` || pathname.startsWith(`/${locale}/`),
  )

  if (hasLocale) {
    /* Remember the locale in the path so a language switch sticks. */
    const current = pathname.split('/')[1]
    const response = NextResponse.next()
    if (request.cookies.get(LOCALE_COOKIE)?.value !== current) {
      response.cookies.set(LOCALE_COOKIE, current, {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        sameSite: 'lax',
      })
    }
    return response
  }

  const locale = negotiateLocale(request)
  const url = request.nextUrl.clone()
  url.pathname = `/${locale}${pathname === '/' ? '' : pathname}`
  return NextResponse.redirect(url)
}

export const config = {
  /* Everything except Next internals, the API (which is locale-agnostic),
     /admin (staff-only, one language — sending it through locale negotiation
     would rewrite /admin to /en/admin and 404), and static files. */
  matcher: ['/((?!api|admin|_next|.*\\..*).*)'],
}
