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
import { clientKey, hit } from '@/lib/rate-limit'

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

/* POST, PATCH and DELETE to the API from another website are refused: a
   page elsewhere cannot sign someone in or out, or change anything, using
   their cookies. Stripe, BOX NOW, the scheduler and mail providers' one-click
   unsubscribe call from outside on purpose and prove themselves otherwise. */
const CROSS_SITE_ALLOWED = ['/api/stripe/webhook', '/api/boxnow/webhook', '/api/cron/', '/api/newsletter/unsubscribe']

function crossSite(request: NextRequest): boolean {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return false
  const { pathname } = request.nextUrl
  if (CROSS_SITE_ALLOWED.some((p) => pathname.startsWith(p))) return false
  const origin = request.headers.get('origin')
  if (origin) {
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host')
    try {
      return new URL(origin).host !== host
    } catch {
      return true
    }
  }
  /* No Origin header (some older browsers): use the browser's own label. */
  return request.headers.get('sec-fetch-site') === 'cross-site'
}

/* Flooding: someone holding down refresh, or a script asking for page after
   page to slow the shop down for everyone. Each address gets a generous
   allowance a person never reaches (two pages a second, every second, for a
   minute); past it the shop answers "slow down" at almost no cost instead of
   building the page. The link prefetching browsers do in the background has
   its own, larger allowance. Photos, payment and courier callbacks and the
   scheduler are not counted here. */
const NOT_COUNTED = ['/api/media/', '/api/stripe/webhook', '/api/boxnow/webhook', '/api/cron/', '/api/version']

function flooding(request: NextRequest): number | null {
  const { pathname } = request.nextUrl
  if (NOT_COUNTED.some((p) => pathname.startsWith(p))) return null
  const ip = clientKey(request)
  const prefetch = request.headers.get('next-router-prefetch') === '1' || request.headers.get('purpose') === 'prefetch'
  const [key, limit] = pathname.startsWith('/api/')
    ? [`flood:api:${ip}`, 300]
    : prefetch
      ? [`flood:prefetch:${ip}`, 600]
      : [`flood:page:${ip}`, 120]
  const r = hit(key, limit, 60)
  return r.ok ? null : r.retryAfterSeconds
}

function slowDown(retryAfter: number, api: boolean) {
  const headers = { 'Retry-After': String(retryAfter), 'Cache-Control': 'no-store' }
  return api
    ? NextResponse.json({ ok: false, error: 'TOO_MANY', message: 'Too many requests. Please wait a moment.' }, { status: 429, headers })
    : new NextResponse('Too many requests. Please wait a moment and try again.', { status: 429, headers: { ...headers, 'Content-Type': 'text/plain; charset=utf-8' } })
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl

  const wait = flooding(request)
  if (wait !== null) return slowDown(wait, pathname.startsWith('/api/'))

  if (pathname.startsWith('/api/')) {
    /* The shop's own forms send a few kilobytes. A huge body sent to fill
       the server's memory is refused before it is read. Staff uploads
       (photos, invoices) go to /api/admin, which has its own limits. */
    const length = Number(request.headers.get('content-length') ?? 0)
    if (length > 256 * 1024 && !pathname.startsWith('/api/admin/') && !pathname.startsWith('/api/stripe/') && !pathname.startsWith('/api/boxnow/')) {
      return NextResponse.json({ ok: false, error: 'TOO_LARGE', message: 'Request too large.' }, { status: 413 })
    }
    if (crossSite(request)) {
      return NextResponse.json({ ok: false, error: 'FORBIDDEN', message: 'Request refused.' }, { status: 403 })
    }
    return NextResponse.next()
  }

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
  /* The API (only for the cross-site check above), and everything except
     Next internals, the API (which is locale-agnostic),
     /admin (staff-only, one language — sending it through locale negotiation
     would rewrite /admin to /en/admin and 404), /link (the Instagram bio
     card, which picks its own language and must stay exactly /link), and
     static files. */
  matcher: ['/api/:path*', '/((?!api|admin|link|_next|.*\\..*).*)'],
}
