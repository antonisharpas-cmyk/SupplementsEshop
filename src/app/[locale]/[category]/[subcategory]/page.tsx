/* A group or section listing: /en/sports-nutrition/protein, or a group with
   sections inside it, /en/clothing/men, which lists them as quick links. */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { findByPath, getCategoryTree, t as tr } from '@/lib/catalog'
import { loadListing } from '@/lib/listing'
import { ProductListingView } from '@/components/ProductListingView'

type Props = {
  params: Promise<{ locale: string; category: string; subcategory: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, category, subcategory } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const sub = findByPath(await getCategoryTree(), [category, subcategory])
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

  const tree = await getCategoryTree()
  const parent = findByPath(tree, [category])
  const sub = findByPath(tree, [category, subcategory])
  if (!parent || !sub) notFound()

  const { filters, listing } = await loadListing(sp, { category, subcategory }, locale)

  return (
    <ProductListingView
      locale={locale}
      title={tr(sub.name, locale)}
      breadcrumb={[{ label: tr(parent.name, locale), href: `/${locale}/${category}` }]}
      sections={sub.children.map((c) => ({ label: tr(c.name, locale), href: `/${locale}/${category}/${subcategory}/${c.slug}` }))}
      listing={listing}
      filters={filters}
      basePath={`/${locale}/${category}/${subcategory}`}
      ctx={`${category}/${subcategory}`}
    />
  )
}
