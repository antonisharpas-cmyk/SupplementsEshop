/* The sign-up on its own page — where the header's "Get new arrivals first"
   goes, and a link to share. */

import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { NewsletterForm } from '@/components/NewsletterForm'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  return { title: getTranslator(locale)('news.eyebrow') }
}

export default async function NewsletterPage({ params }: Props) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  return (
    <div className="container-x py-16 md:py-24">
      <div className="mx-auto max-w-xl">
        <p className="label text-muted">{t('news.eyebrow')}</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight md:text-4xl">{t('news.title')}</h1>
        <p className="mt-4 text-ink-soft">{t('news.pageSub')}</p>
        <p className="mt-2 text-sm text-muted">{t('news.body')}</p>
        <div className="mt-8">
          <NewsletterForm locale={locale} source="newsletter_page" />
        </div>
      </div>
    </div>
  )
}
