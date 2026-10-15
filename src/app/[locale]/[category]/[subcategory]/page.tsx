/* Subcategory listing — /en/men/hoodies. */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getCategoryBySlug, t as tr } from '@/lib/catalog'
import { loadListing } from '@/lib/listing'
import { ProductListingView } from '@/components/ProductListingView'

type Props = {
  params: Promise<{ locale: string; category: string; subcategory: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, category, subcategory } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const sub = await getCategoryBySlug(subcategory, category)
  if (!sub) return { title: 'Not found' }

  const name = tr(sub.name, locale)
  return {
    title: tr(sub.seoTitle, locale) || name,
    description: tr(sub.seoDescription, locale) || `Shop ${name} at ${BRAND.name}.`,
    alternates: { canonical: `/${locale}/${category}/${subcategory}` },
  }
}

export default async function SubcategoryPage({ params, searchParams }: Props) {
  const { locale: raw, category, subcategory } = await params
  const sp = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale

  const [parent, sub] = await Promise.all([
    getCategoryBySlug(category),
    getCategoryBySlug(subcategory, category),
  ])
  if (!parent || !sub) notFound()

  const { filters, listing } = await loadListing(sp, { category, subcategory }, locale)

  return (
    <ProductListingView
      locale={locale}
      title={tr(sub.name, locale)}
      breadcrumb={[{ label: tr(parent.name, locale), href: `/${locale}/${category}` }]}
      listing={listing}
      filters={filters}
      basePath={`/${locale}/${category}/${subcategory}`}
      ctx={`${category}/${subcategory}`}
    />
  )
}
