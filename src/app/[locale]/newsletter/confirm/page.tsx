/* The link in the confirmation email lands here. Opening it is the
   confirmation, that is what double opt-in means, and a second visit, or a
   mail scanner opening it first, changes nothing further. */

import Link from 'next/link'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { confirmSubscription } from '@/lib/newsletter'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Newsletter', robots: { index: false, follow: false } }

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }

export default async function ConfirmPage({ params, searchParams }: Props) {
  const { locale: raw } = await params
  const { token } = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const { ok } = await confirmSubscription(token)

  return (
    <div className="container-x py-20 md:py-28">
      <div className="mx-auto max-w-lg text-center">
        <p aria-hidden className="text-3xl">{ok ? '✓' : '—'}</p>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight md:text-3xl">
          {ok ? t('news.confirmedTitle') : t('news.linkInvalidTitle')}
        </h1>
        <p className="mt-3 text-ink-soft">{ok ? t('news.confirmedBody') : t('news.linkInvalidBody')}</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href={ok ? `/${locale}/new` : `/${locale}/newsletter`} className="btn btn-primary">
            {ok ? t('home.shopNewArrivals') : t('news.submit')}
          </Link>
          <Link href={`/${locale}`} className="btn btn-ghost">
            {t('news.backToShop')}
          </Link>
        </div>
      </div>
    </div>
  )
}
