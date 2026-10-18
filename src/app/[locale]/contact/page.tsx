/* ============================================================================
 * Help & contact — every way to reach the shop, and the answers people most
 * often need before they ask. Delivery, returns and the store have anchors
 * (#delivery, #returns, #store) so the footer and homepage link straight to
 * them. Every number comes from Settings, so the page cannot disagree with
 * the checkout.
 * ========================================================================== */

import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getSettings } from '@/lib/settings'
import { formatMoney } from '@/lib/pricing'
import { OpenChatButton } from '@/components/OpenChatButton'

type Props = { params: Promise<{ locale: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  return { title: getTranslator(locale)('help.title') }
}

export default async function ContactPage({ params }: Props) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const s = await getSettings([
    'reservation_ttl_seconds',
    'free_delivery_threshold_cents',
    'estimated_delivery_min_days',
    'estimated_delivery_max_days',
    'support_idle_minutes',
  ])
  const threshold = formatMoney(s.free_delivery_threshold_cents, locale)
  const brand = BRAND.name

  const faq = [
    [t('help.q1'), t('help.a1', { minutes: Math.round(s.reservation_ttl_seconds / 60) })],
    [t('help.q3'), t('help.a3', { min: s.estimated_delivery_min_days, max: s.estimated_delivery_max_days, threshold })],
    [t('help.q4'), t('help.a4')],
    [t('help.q5'), t('help.a5')],
  ]

  const card = 'border-t border-ink pt-4'

  return (
    <div className="container-x py-12 md:py-16">
      <header className="max-w-2xl">
        <h1 className="text-3xl font-semibold tracking-tight md:text-4xl">{t('help.title')}</h1>
        <p className="mt-3 text-ink-soft">{t('help.sub')}</p>
      </header>

      <section aria-labelledby="chat-title" className="mt-10 flex flex-col gap-5 rounded-3xl bg-gold p-6 text-paper sm:flex-row sm:items-center sm:justify-between md:p-8">
        <div className="max-w-xl">
          <h2 id="chat-title" className="text-xl font-semibold tracking-tight">
            {t('support.title', { brand })}
          </h2>
          <p className="mt-2 text-sm text-paper/75">
            {t('help.chatBody')} {t('support.idleNote', { minutes: s.support_idle_minutes })}
          </p>
        </div>
        <OpenChatButton label={t('home.startChat')} className="btn btn-dark shrink-0" />
      </section>

      <section className="mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
        <div className={card}>
          <h2 className="label">{t('help.emailTitle')}</h2>
          <a href={`mailto:${BRAND.contact.email}`} className="mt-2 block text-sm underline underline-offset-4">
            {BRAND.contact.email}
          </a>
        </div>
        <div className={card}>
          <h2 className="label">{t('help.phoneTitle')}</h2>
          <a href={`tel:${BRAND.contact.phone.replace(/\s+/g, '')}`} className="mt-2 block text-sm underline underline-offset-4">
            {BRAND.contact.phone}
          </a>
        </div>
        <div className={card}>
          <h2 className="label">{t('help.hoursTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{BRAND.contact.openingHours}</p>
        </div>
        <div id="store" className={`${card} scroll-mt-28`}>
          <h2 className="label">{t('help.storeTitle')}</h2>
          <p className="mt-2 text-sm text-muted">
            {BRAND.contact.pickupName}
            <br />
            {BRAND.contact.addressLines.join(', ')}
          </p>
        </div>
      </section>

      <section className="mt-12 grid gap-8 md:grid-cols-2">
        <div id="delivery" className={`${card} scroll-mt-28`}>
          <h2 className="label">{t('footer.delivery')}</h2>
          <p className="mt-2 text-sm text-muted">{t('pdp.deliveryBody', { threshold })}</p>
          <p className="mt-2 text-sm text-muted">
            {t('help.a3', { min: s.estimated_delivery_min_days, max: s.estimated_delivery_max_days, threshold })}
          </p>
        </div>
        <div id="returns" className={`${card} scroll-mt-28`}>
          <h2 className="label">{t('footer.returns')}</h2>
          <p className="mt-2 text-sm text-muted">{t('help.returnsBody')}</p>
        </div>
      </section>

      <section aria-labelledby="faq-title" className="mt-14 max-w-3xl">
        <h2 id="faq-title" className="text-xl font-semibold tracking-tight">
          {t('help.faqTitle')}
        </h2>
        <div className="mt-4 divide-y divide-[var(--color-line)] border-y border-line">
          {faq.map(([q, a]) => (
            <details key={q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-medium">
                {q}
                <span aria-hidden className="text-muted transition-transform group-open:rotate-45">
                  +
                </span>
              </summary>
              <p className="mt-2 text-sm text-muted">{a}</p>
            </details>
          ))}
        </div>
      </section>
    </div>
  )
}
