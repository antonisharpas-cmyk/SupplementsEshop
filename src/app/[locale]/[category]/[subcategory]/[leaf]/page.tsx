/* A section inside a group: /en/clothing/men/socks. */
import { notFound } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { findByPath, getCategoryTree, t as tr } from '@/lib/catalog'
import { loadListing } from '@/lib/listing'
import { ProductListingView } from '@/components/ProductListingView'

type Props = {
  params: Promise<{ locale: string; category: string; subcategory: string; leaf: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw, category, subcategory, leaf } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const node = findByPath(await getCategoryTree(), [category, subcategory, leaf])
  if (!node) return { title: 'Not found' }
  const name = tr(node.name, locale)
  return {
    title: tr(node.seoTitle, locale) || name,
    description: tr(node.seoDescription, locale) || `Shop ${name} at ${BRAND.name}.`,
    alternates: { canonical: `/${locale}/${category}/${subcategory}/${leaf}` },
  }
}

export default async function LeafPage({ params, searchParams }: Props) {
  const { locale: raw, category, subcategory, leaf } = await params
  const sp = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale

  const tree = await getCategoryTree()
  const range = findByPath(tree, [category])
  const group = findByPath(tree, [category, subcategory])
  const node = findByPath(tree, [category, subcategory, leaf])
  if (!range || !group || !node) notFound()

  const { filters, listing } = await loadListing(sp, { category, subcategory, leaf }, locale)

  return (
    <ProductListingView
      locale={locale}
      title={tr(node.name, locale)}
      breadcrumb={[
        { label: tr(range.name, locale), href: `/${locale}/${category}` },
        { label: tr(group.name, locale), href: `/${locale}/${category}/${subcategory}` },
      ]}
      listing={listing}
      filters={filters}
      basePath={`/${locale}/${category}/${subcategory}/${leaf}`}
      ctx={`${category}/${subcategory}/${leaf}`}
    />
  )
}
