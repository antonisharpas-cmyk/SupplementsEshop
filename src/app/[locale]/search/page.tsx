/* Search results page. */
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { loadListing } from '@/lib/listing'
import { ProductListingView } from '@/components/ProductListingView'

type Props = {
  params: Promise<{ locale: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ searchParams }: Props): Promise<Metadata> {
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q : ''
  return {
    title: q ? `“${q}”` : 'Search',
    /* A search results page should not compete with the category pages it
       duplicates, so keep it out of the index. */
    robots: { index: false, follow: true },
  }
}

export default async function SearchPage({ params, searchParams }: Props) {
  const { locale: raw } = await params
  const sp = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)

  const { filters, listing } = await loadListing(sp, { kind: 'search' }, locale)

  return (
    <ProductListingView
      locale={locale}
      title={filters.q ? t('list.searchResultsFor', { q: filters.q }) : t('nav.search')}
      listing={listing}
      filters={filters}
      basePath={`/${locale}/search`}
      ctx="search"
    />
  )
}
