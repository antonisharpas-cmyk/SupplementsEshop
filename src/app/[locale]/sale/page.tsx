/* Everything reduced right now — a sale price or a live promotion. Where promotion emails point. */
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
  return { title: t('home.onSale') }
}

export default async function SalePage({ params, searchParams }: Props) {
  const { locale: raw } = await params
  const sp = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)

  const { filters, listing } = await loadListing(sp, { kind: 'sale' }, locale)

  return (
    <ProductListingView locale={locale} title={t('home.onSale')} listing={listing} filters={filters} basePath={`/${locale}/sale`} ctx="sale" salePage />
  )
}
