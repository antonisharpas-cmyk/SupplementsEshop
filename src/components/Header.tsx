import Link from 'next/link'
import { BRAND, LOCALE_LABELS, LOCALES, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { t as tr } from '@/lib/catalog'
import type { CategoryNode } from '@/lib/catalog'
import { SearchBox } from './SearchBox'
import { MobileNav } from './MobileNav'
import { HeaderBag, UserIcon } from './HeaderIcons'

/* Server component. The interactive pieces — search, the bag count and the
   mobile drawer, are small client components.

   Desktop:  Logo · Shop (the category menu) · Search · Account · Bag
   Mobile:   Logo · Search · Account · Bag · Menu */

export function Header({
  locale,
  categories,
  cartCount,
  signedIn,
}: {
  locale: Locale
  categories: CategoryNode[]
  cartCount: number
  signedIn: boolean
}) {
  const t = getTranslator(locale)
  const base = `/${locale}`

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur">
      {/* announcement strip: the newsletter invitation, as a real link */}
      <div className="border-b border-line bg-gold text-paper">
        <div className="container-x flex h-9 items-center justify-center">
          <Link href={`${base}/newsletter`} className="label truncate hover:underline underline-offset-4">
            {t('footer.newsletter')} <span aria-hidden>→</span>
          </Link>
        </div>
      </div>

      <div className="container-x flex h-16 items-center gap-4">
        <Link href={base} className="flex shrink-0 items-center gap-2.5" aria-label={BRAND.name}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo.mark} alt="" width={46} height={24} className="h-6 w-auto" />
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo.wordmark} alt={BRAND.name} width={571} height={71} className="h-4 w-auto sm:h-[18px]" />
        </Link>

        {/* desktop nav */}
        <nav className="ml-6 hidden items-stretch gap-7 lg:flex" aria-label="Main">
          {categories.map((root) => (
            <div key={root.id} className="group relative flex items-center">
              <Link href={`${base}/${root.slug}`} className="label py-5 transition-colors hover:text-accent">
                {tr(root.name, locale)}
              </Link>

              {root.children.length > 0 && (
                <div className="invisible absolute top-full left-0 min-w-56 border border-line bg-paper opacity-0 shadow-lg transition-opacity group-hover:visible group-hover:opacity-100 focus-within:visible focus-within:opacity-100">
                  <ul className="py-2">
                    {root.children.map((child) => (
                      <li key={child.id}>
                        <Link
                          href={`${base}/${root.slug}/${child.slug}`}
                          className="block px-4 py-2 text-sm hover:bg-paper-2 hover:text-accent"
                        >
                          {tr(child.name, locale)}
                        </Link>
                      </li>
                    ))}
                    <li className="mt-1 border-t border-line pt-1">
                      <Link href={`${base}/${root.slug}`} className="block px-4 py-2 label hover:bg-paper-2">
                        {t('nav.allIn', { category: tr(root.name, locale) })}
                      </Link>
                    </li>
                  </ul>
                </div>
              )}
            </div>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-0.5 sm:gap-1">
          <SearchBox locale={locale} placeholder={t('nav.searchPlaceholder')} label={t('nav.search')} />

          <Link href={`${base}/contact`} className="hidden px-2 py-1 label text-muted hover:text-ink lg:inline">
            {t('nav.help')}
          </Link>

          {/* language switcher — a plain form so it works without JS */}
          <div className="hidden items-center gap-1 sm:flex" role="group" aria-label={t('nav.language')}>
            {LOCALES.map((code) => (
              <Link
                key={code}
                href={`/${code}`}
                hrefLang={code}
                aria-current={code === locale ? 'true' : undefined}
                className={`px-2 py-1 text-[11px] font-semibold uppercase ${
                  code === locale ? 'text-accent underline' : 'text-muted hover:text-ink'
                }`}
              >
                {code === 'el' ? 'ΕΛ' : code.toUpperCase()}
              </Link>
            ))}
          </div>

          <Link
            href={signedIn ? `${base}/account` : `${base}/sign-in`}
            aria-label={signedIn ? t('nav.account') : t('auth.signIn')}
            title={signedIn ? t('nav.account') : t('auth.signIn')}
            className="relative grid h-10 w-10 place-items-center hover:text-ink-soft"
          >
            <UserIcon />
            {signedIn && <span aria-hidden className="absolute bottom-2 right-2 h-1.5 w-1.5 rounded-full bg-accent" />}
          </Link>

          <HeaderBag locale={locale} initialCount={cartCount} />

          <MobileNav locale={locale} categories={categories} />
        </div>
      </div>
    </header>
  )
}

export function Footer({ locale }: { locale: Locale }) {
  const t = getTranslator(locale)
  const base = `/${locale}`

  const columns: { title: string; links: [string, string][] }[] = [
    {
      title: t('footer.help'),
      links: [
        /* Order tracking and terms join this list when those pages exist —
           a footer link to a 404 is worse than no link. */
        [t('footer.contact'), `${base}/contact`],
        [t('footer.delivery'), `${base}/contact#delivery`],
        [t('footer.returns'), `${base}/contact#returns`],
      ],
    },
    {
      title: t('footer.about'),
      links: [
        [t('footer.newsletter'), `${base}/newsletter`],
        [t('footer.privacy'), `${base}/privacy`],
      ],
    },
  ]

  return (
    <footer className="mt-20 border-t border-line bg-paper-2">
      <div className="container-x grid gap-10 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo.full} alt={BRAND.name} width={800} height={454} className="h-20 w-auto" />
          <p className="mt-3 max-w-sm text-sm text-muted">{BRAND.contact.addressLines.join(', ')}</p>
          <p className="mt-2 text-sm text-muted">
            {BRAND.contact.email} · {BRAND.contact.phone}
          </p>
          <div className="mt-4 flex gap-2">
            {LOCALES.map((code) => (
              <Link
                key={code}
                href={`/${code}`}
                hrefLang={code}
                className="rounded-full border border-line px-3 py-1 text-[11px] transition-colors hover:border-accent hover:text-accent"
              >
                {LOCALE_LABELS[code]}
              </Link>
            ))}
          </div>
        </div>

        {columns.map((col) => (
          <div key={col.title}>
            <h3 className="label mb-4 text-muted">{col.title}</h3>
            <ul className="space-y-2.5">
              {col.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} className="text-sm hover:underline">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-line">
        <div className="container-x flex flex-wrap gap-2 py-5 text-xs text-muted">
          <p>
            © {new Date().getFullYear()} {BRAND.legal.companyName}. {t('footer.rights')}
          </p>
          <p className="ml-auto">
            {t('footer.vat')} {BRAND.legal.vatNumber} · Reg. {BRAND.legal.registrationNumber}
          </p>
        </div>
      </div>
    </footer>
  )
}
