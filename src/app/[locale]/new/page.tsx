/* New arrivals: the whole catalogue, newest first. Where "Shop new arrivals" and the new-arrivals emails point. */
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { loadListing } from '@/lib/listing'
import { ProductListingView } from '@/components/ProductListingView'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  return { title: t('new.title') }
}

export default async function NewArrivalsPage({ params, searchParams }: Props) {
  const { locale: raw } = await params
  const sp = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)

  const { filters, listing } = await loadListing(sp, { kind: 'new' }, locale)

  return (
    <ProductListingView locale={locale} title={t('new.title')} listing={listing} filters={filters} basePath={`/${locale}/new`} ctx="new" intro={t('new.sub')} />
  )
}
