/* ============================================================================
 * Homepage — spec section 2.
 *
 * Hero comes from the `hero_banners` table so the shop owner can change it
 * without a deploy (section 32). An active promotion flagged `showOnHomepage`
 * appears as a strip below it, and the whole promotion block can be switched
 * off with one setting (section 2).
 * ========================================================================== */

import Link from 'next/link'
import { and, desc, eq, isNull, lte, or, sql } from 'drizzle-orm'
import { db } from '@/db'
import { assertSchemaReady } from '@/db/ready'
import { heroBanners, promotions } from '@/db/schema'
import { BRAND, LOCALES, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCategoryTree, t as tr } from '@/lib/catalog'
import { getHomepageContent } from '@/lib/homepage-content'
import { getSetting } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { ProductCard } from '@/components/ProductCard'
import { ProductMarquee } from '@/components/ProductMarquee'
import { HeroMedia } from '@/components/HeroMedia'
import { videoSources } from '@/lib/media'
import { SectionHead } from '@/components/ui'
import { NewsletterForm } from '@/components/NewsletterForm'
import { OpenChatButton } from '@/components/OpenChatButton'

export const revalidate = 60

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  const lang = isLocale(locale) ? locale : 'en'
  return {
    alternates: {
      canonical: `/${lang}`,
      languages: Object.fromEntries(LOCALES.map((l) => [l, `/${l}`])),
    },
  }
}

async function getHero() {
  const now = new Date()
  const [banner] = await db
    .select()
    .from(heroBanners)
    .where(
      and(
        eq(heroBanners.isActive, true),
        or(isNull(heroBanners.startsAt), lte(heroBanners.startsAt, now)),
        or(isNull(heroBanners.endsAt), sql`${heroBanners.endsAt} > ${now}`),
      ),
    )
    .orderBy(heroBanners.position)
    .limit(1)
  return banner ?? null
}

async function getHomepagePromotion() {
  const enabled = await getSetting('homepage_promotions_enabled')
  if (!enabled) return null

  const now = new Date()
  const [promo] = await db
    .select()
    .from(promotions)
    .where(
      and(
        eq(promotions.isActive, true),
        eq(promotions.showOnHomepage, true),
        lte(promotions.startsAt, now),
        or(isNull(promotions.endsAt), sql`${promotions.endsAt} > ${now}`),
      ),
    )
    .orderBy(desc(promotions.priority))
    .limit(1)
  return promo ?? null
}

/** Where "Shop now" on the promotion strip should go.
 *
 *  A promotion can be scoped to a subcategory, so looking only at the root
 *  categories found nothing and silently linked back to the homepage. This
 *  walks both levels and builds the full /sports-nutrition/protein path. */
function promotionHref(
  base: string,
  categories: { id: string; slug: string; children: { id: string; slug: string; children?: { id: string; slug: string }[] }[] }[],
  categoryId: string | null,
): string {
  const fallback = categories[0] ? `${base}/${categories[0].slug}` : `${base}/new`
  if (!categoryId) return fallback

  for (const root of categories) {
    if (root.id === categoryId) return `${base}/${root.slug}`
    for (const child of root.children) {
      if (child.id === categoryId) return `${base}/${root.slug}/${child.slug}`
      const leaf = child.children?.find((c) => c.id === categoryId)
      if (leaf) return `${base}/${root.slug}/${child.slug}/${leaf.slug}`
    }
  }
  /* Scoped to something not in the navigation: send them somewhere real. */
  return fallback
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const base = `/${locale}`

  /* The layout checks this too, but a page renders in parallel with its
     layout, without waiting here, the hero query can run first and fail on
     a column a pending migration is about to add. */
  await assertSchemaReady()

  const [hero, promo, categories, content, threshold] = await Promise.all([
    getHero(),
    getHomepagePromotion(),
    getCategoryTree(),
    /* The sections under the hero — their order, visibility and
       contents are the shop owner's, set in /admin/homepage. */
    getHomepageContent(locale, { onlyVisible: true }),
    getSetting('free_delivery_threshold_cents'),
  ])
  const { layout, tiles, trending, newIn, onSale } = content

  return (
    <>
      {/* ---------------------------------------------------------- hero --- */}
      {hero && (
        <section className="relative">
          <div className="relative min-h-[70vh] overflow-hidden bg-accent md:min-h-[82vh]">
            {hero.videoUrl ? (
              <HeroMedia
                video={videoSources(hero.videoUrl)}
                mobileVideo={videoSources(hero.mobileVideoUrl)}
                poster={hero.imageUrl}
                mobilePoster={hero.mobileImageUrl}
                pauseLabel={t('home.heroPause')}
                playLabel={t('home.heroPlay')}
              />
            ) : (
              hero.imageUrl && (
                /* eslint-disable-next-line @next/next/no-img-element */
                <img
                  src={hero.imageUrl}
                  alt=""
                  fetchPriority="high"
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )
            )}

            {/* Legibility. Desktop reads left to right, so the shade sits under
                the words on the left and clears before the subject; on a phone
                the words sit at the bottom, so the shade rises from there. */}
            <div className="pointer-events-none absolute inset-0 hidden bg-gradient-to-r from-black/60 via-black/25 to-transparent md:block" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent md:hidden" />

            <div className="container-x relative z-10 flex min-h-[70vh] items-end pb-16 md:min-h-[82vh] md:items-center md:pb-0">
              <div className="max-w-xl text-white">
                <h1 className="hero-rise hero-rise-1 text-[clamp(2.5rem,6vw,4.9rem)] leading-[1.04] font-bold tracking-[-0.035em]">
                  {tr(hero.title, locale)}
                </h1>
                {hero.subtitle && (
                  <p className="hero-rise hero-rise-2 mt-5 max-w-md text-[15px] text-white/85 md:text-base">
                    {tr(hero.subtitle, locale)}
                  </p>
                )}
                <div className="hero-rise hero-rise-3 mt-8 flex flex-wrap gap-3">
                  {hero.primaryCtaLabel && hero.primaryCtaHref && (
                    <Link
                      href={`${base}${hero.primaryCtaHref}`}
                      className="btn btn-primary sm:btn-lg"
                    >
                      {tr(hero.primaryCtaLabel, locale)}
                    </Link>
                  )}
                  {hero.secondaryCtaLabel && hero.secondaryCtaHref && (
                    <Link
                      href={`${base}${hero.secondaryCtaHref}`}
                      className="btn btn-secondary sm:btn-lg"
                    >
                      {tr(hero.secondaryCtaLabel, locale)}
                    </Link>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ----------------------------------------------------- promotion --- */}
      {promo && (
        <section className="border-b border-line bg-sale text-white">
          <div className="container-x flex flex-wrap items-center justify-center gap-x-5 gap-y-2 py-4 text-center">
            {/* The badge text, when the shop owner has written one, IS the
                whole message, it already says "20% OFF". Only fall back to
                the internal promotion name plus a computed discount when no
                badge has been written. */}
            <p className="label">
              {promo.badgeText
                ? tr(promo.badgeText, locale)
                : `${promo.name}, ${
                    promo.discountType === 'PERCENTAGE'
                      ? `${promo.discountValue}% off`
                      : `${formatMoney(promo.discountValue, locale)} off`
                  }`}
            </p>
            <Link
              href={promotionHref(base, categories, promo.categoryId)}
              className="label border-b border-white pb-0.5 hover:opacity-80"
            >
              {t('home.shopNow')}
            </Link>
          </div>
        </section>
      )}

      {layout
        .filter((section) => section.isVisible)
        .map((section) => {
          switch (section.key) {
            /* -------------------------------------------- categories --- */
            case 'categories':
              if (tiles.length === 0) return null
              return (
                <section key="categories" className="container-x py-14">
                  <SectionHead title={t('home.categories')} />
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                    {tiles.map(({ root, child }) => (
                      <Link
                        key={child.id}
                        href={`${base}/${root.slug}/${child.slug}`}
                        className="group relative flex aspect-4/5 flex-col justify-end overflow-hidden border border-line bg-paper-2 p-4 transition-colors hover:border-accent"
                      >
                        {child.imageUrl && (
                          <>
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={child.imageUrl}
                              alt=""
                              loading="lazy"
                              className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
                          </>
                        )}
                        <span
                          className={`label relative ${child.imageUrl ? 'text-white/70' : 'text-muted'}`}
                        >
                          {tr(root.name, locale)}
                        </span>
                        <span
                          className={`relative mt-1 text-lg font-semibold tracking-tight ${
                            child.imageUrl ? 'text-white' : ''
                          }`}
                        >
                          {tr(child.name, locale)}
                        </span>
                      </Link>
                    ))}
                  </div>
                </section>
              )

            /* ------------------------------------------- moving strip --- */
            case 'trending':
              /* A loop of one or two products reads as a glitch, not a strip. */
              if (trending.length < 3) return null
              return (
                <section key="trending" className="-mt-px border-y border-line py-12">
                  <div className="container-x">
                    <SectionHead title={t('home.trending')} sub={t('home.trendingSub')} />
                  </div>
                  {/* Full-bleed: the strip runs off both edges of the screen,
                      which is what makes it read as continuous. */}
                  <ProductMarquee products={trending} locale={locale} seconds={52} />
                </section>
              )

            /* ------------------------------------------------- new in --- */
            case 'new_in':
              if (newIn.length === 0) return null
              return (
                <section key="new_in" className="container-x py-14">
                  <SectionHead
                    title={t('home.justDropped')}
                    sub={t('home.justDroppedSub')}
                    href={`${base}/new`}
                    hrefLabel={t('home.viewAll')}
                  />
                  <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4">
                    {newIn.map((product, i) => (
                      <ProductCard key={product.id} product={product} locale={locale} priority={i < 4} />
                    ))}
                  </div>
                  <div className="mt-10 flex justify-center">
                    <Link
                      href={`${base}/new`}
                      className="btn btn-primary sm:btn-lg"
                    >
                      {t('home.shopNewArrivals')}
                    </Link>
                  </div>
                </section>
              )

            /* ------------------------------------------- newsletter --- */
            case 'newsletter':
              /* An invitation in the page, never a pop-up or a gate. */
              return (
                <section key="newsletter" aria-labelledby="newsletter-title" className="bg-silver relative overflow-hidden text-paper">
                  <div className="container-x grid grid-cols-1 gap-10 py-16 md:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] md:items-center md:py-20">
                    <div>
                      <p className="label text-paper/60">{t('news.eyebrow')}</p>
                      <span aria-hidden className="mt-3 block h-1 w-12 rounded-full bg-gold" />
                      <h2 id="newsletter-title" className="mt-3 text-[clamp(1.8rem,3.6vw,2.8rem)] font-semibold leading-[1.05] tracking-tight text-paper">
                        {t('news.title')}
                      </h2>
                      <p className="mt-4 max-w-md text-sm leading-relaxed text-paper/75">{t('news.body')}</p>
                    </div>
                    <NewsletterForm locale={locale} source="homepage" tone="dark" />
                  </div>
                </section>
              )

            /* ------------------------------------------------ on sale --- */
            case 'on_sale':
              if (onSale.length === 0) return null
              return (
                <section key="on_sale" className="-mt-px border-y border-line bg-paper-2">
                  <div className="container-x py-14">
                    <SectionHead title={t('home.onSale')} />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-8 md:grid-cols-4">
                      {onSale.map((product) => (
                        <ProductCard key={product.id} product={product} locale={locale} />
                      ))}
                    </div>
                  </div>
                </section>
              )
          }
        })}

      {/* ----------------------------------------------------- reassurance - */}
      <section className="container-x grid grid-cols-1 gap-8 py-14 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            title: t('footer.delivery'),
            body: t('pdp.deliveryBody', { threshold: formatMoney(threshold, locale) }),
            href: `${base}/contact#delivery`,
          },
          { title: t('footer.returns'), body: t('help.returnsBody'), href: `${base}/contact#returns` },
          { title: BRAND.contact.pickupName, body: BRAND.contact.openingHours, href: `${base}/contact#store` },
        ].map((item) => (
          <div key={item.title} className="border-t border-ink pt-4">
            <h3 className="label">
              <Link href={item.href} className="hover:underline">
                {item.title}
              </Link>
            </h3>
            <p className="mt-2 text-sm text-muted">{item.body}</p>
          </div>
        ))}
        <div className="border-t border-ink pt-4">
          <h3 className="label">{t('home.helpTitle')}</h3>
          <p className="mt-2 text-sm text-muted">{t('home.helpBody')}</p>
          <OpenChatButton label={t('home.startChat')} className="mt-3 label underline underline-offset-4 hover:opacity-70" />
        </div>
      </section>
    </>
  )
}
