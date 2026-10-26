/* ============================================================================
 * One product.
 *
 * Laid out as named sections with a jump list, so new ones (names and
 * descriptions, SEO, merchandising) slot in as another <Section> rather than
 * a redesign. Each section saves on its own; there is no page-wide "Save".
 * ========================================================================== */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { getAdminProduct, getProductImages, guardAdmin } from '@/lib/admin'
import { listStockRows, productStatus } from '@/lib/admin-catalog'
import { categoryOptions, listAdminVariants } from '@/lib/admin-products'
import { getSettings } from '@/lib/settings'
import { tField as tr } from '@/i18n/field'
import { PriceEditor, StatusControl } from '@/components/admin/ProductEditor'
import { VariantManager } from '@/components/admin/VariantManager'
import { DeleteProduct, DetailsEditor } from '@/components/admin/ProductDetails'
import { PhotoOrder } from '@/components/admin/PhotoOrder'
import { PageHead, StatusBadge, btn } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

const SECTIONS = [
  { id: 'status', label: 'Status' },
  { id: 'pricing', label: 'Pricing' },
  { id: 'photos', label: 'Photos' },
  { id: 'variants', label: 'Flavours and stock' },
  { id: 'details', label: 'Details' },
  { id: 'delete', label: 'Delete' },
]

function Section({ id, title, sub, children }: { id: string; title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-6 border border-line bg-paper p-5 sm:p-6">
      <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {sub && <p className="mt-1 max-w-2xl text-sm text-muted">{sub}</p>}
      <div className="mt-5">{children}</div>
    </section>
  )
}

export default async function AdminProductPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | undefined>>
}) {
  const { id } = await params
  const sp = await searchParams
  await guardAdmin(`/admin/products/${id}`)
  /* A mistyped address is "not found", not a database error about uuids. */
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound()

  const settings = await getSettings(['low_stock_threshold'])
  const low = settings.low_stock_threshold
  const [product, photos, stock, variants, groups] = await Promise.all([
    getAdminProduct(id),
    getProductImages(id),
    listStockRows({ product: id, view: 'all', sort: 'colour' }, low),
    listAdminVariants(id),
    categoryOptions(),
  ])
  if (!product) notFound()

  const status = productStatus(product.isActive, product.availability)
  const available = stock.rows.reduce((n, r) => n + Math.max(0, r.available), 0)

  return (
    <>
      <nav aria-label="Breadcrumb" className="mb-5 flex gap-2 text-xs text-muted">
        <Link href="/admin/products" className="hover:underline">
          Products
        </Link>
        <span aria-hidden>/</span>
        <span className="text-ink">{tr(product.name, 'en')}</span>
      </nav>

      <PageHead
        title={tr(product.name, 'en')}
        sub={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{tr(product.categoryName, 'en')}</span>
            <span className="font-mono text-xs">{product.slug}</span>
            <StatusBadge status={status} />
            <span>{available} available across {stock.total} variant{stock.total === 1 ? '' : 's'}</span>
          </span>
        }
        action={
          <Link href={`/en/products/${product.slug}`} className={btn.secondary} target="_blank">
            View in shop ↗
          </Link>
        }
      />

      {sp.created && (
        <p role="status" className="mb-6 border border-ok/40 bg-ok/10 px-4 py-3 text-sm text-ok">
          Product created. It is Hidden for now: add photos, flavours and stock below, then set it to Available.
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[11rem_minmax(0,1fr)]">
        <nav aria-label="Sections" className="hidden lg:block">
          <ul className="sticky top-6 space-y-1 text-sm">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="block border-l-2 border-transparent py-1.5 pl-3 text-muted hover:border-ink hover:text-ink">
                  {s.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="space-y-6">
          <Section
            id="status"
            title="Status"
            sub="Sold out and hidden are different: a sold-out piece stays on show so people can still find it, a hidden one leaves the shop. Neither deletes anything."
          >
            <StatusControl productId={product.id} status={status} />
            {status === 'available' && available === 0 && (
              <p className="mt-3 text-sm text-muted">
                Every size is at zero, so the shop already shows it as sold out. Add stock below and it is back on sale.
              </p>
            )}
          </Section>

          <Section id="pricing" title="Pricing">
            <PriceEditor productId={product.id} priceCents={product.priceCents} salePriceCents={product.salePriceCents} />
          </Section>

          <Section
            id="photos"
            title="Photos"
            sub="Upload, remove, and drag to reorder. The first is on every card; the second shows when a shopper points at the card. Under each photo choose the flavour it shows: when a shopper picks that flavour, its photos come first."
          >
            <PhotoOrder
              productId={product.id}
              photos={photos.map((p) => ({ id: p.id, url: p.url, variantId: p.variantId }))}
              variants={variants.map((v) => ({ id: v.id, label: [v.flavour?.en, v.size].filter(Boolean).join(', ') }))}
            />
          </Section>

          <Section
            id="variants"
            title="Flavours, sizes & stock"
            sub={
              <>
                One line per flavour and size. A line can have its own price (bigger tubs cost more); empty means the
                product price. Stock saves when you press Enter.{' '}
                <Link href={`/admin/stock?product=${product.id}&view=all`} className="underline hover:text-ink">
                  Open in Stock
                </Link>
              </>
            }
          >
            <VariantManager productId={product.id} rows={variants} basePrice={product.priceCents} />
          </Section>

          <Section
            id="details"
            title="Details"
            sub="Name, text and category in English, Greek and Russian. Empty Greek or Russian shows the English."
          >
            <DetailsEditor
              productId={product.id}
              groups={groups}
              initial={{
                name: product.name,
                summary: product.summary,
                description: product.description,
                usage: product.sizeGuide,
                seoTitle: product.seoTitle,
                seoDescription: product.seoDescription,
                categoryId: product.categoryId,
                slug: product.slug,
              }}
            />
          </Section>

          <Section id="delete" title="Delete">
            <DeleteProduct productId={product.id} name={tr(product.name, 'en')} />
          </Section>
        </div>
      </div>
    </>
  )
}
