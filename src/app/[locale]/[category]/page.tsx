/* Category listing — /en/men. Lists the category and its subcategories. */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getCategoryBySlug, t as tr } from '@/lib/catalog'
import { loadListing } from '@/lib/listing'
import { ProductListingView } from '@/components/ProductListingView'

type Props = {
  params: Promise<{ locale: string; category: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, category: slug } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const category = await getCategoryBySlug(slug)
  if (!category) return { title: 'Not found' }

  const name = tr(category.name, locale)
  return {
    title: tr(category.seoTitle, locale) || name,
    description: tr(category.seoDescription, locale) || `Shop ${name} at ${BRAND.name}.`,
    alternates: { canonical: `/${locale}/${slug}` },
  }
}

export default async function CategoryPage({ params, searchParams }: Props) {
  const { locale: raw, category: slug } = await params
  const sp = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale

  const category = await getCategoryBySlug(slug)
  if (!category) notFound()

  const { filters, listing } = await loadListing(sp, { category: slug }, locale)

  return (
    <ProductListingView
      locale={locale}
      title={tr(category.name, locale)}
      listing={listing}
      filters={filters}
      basePath={`/${locale}/${slug}`}
      ctx={slug}
    />
  )
}
