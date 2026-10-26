/* The member's tier: what it gives, how long it lasts, the road to the next
   one, what keeping it takes, and the whole ladder. */

import Link from 'next/link'
import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { getCurrentUser } from '@/lib/auth/session'
import { customerTier, TIER_KEYS, TIER_NAMES, TIER_TAGLINES } from '@/lib/loyalty'
import { formatMoney } from '@/lib/pricing'
import { TierBadge } from '@/components/TierBadge'

export const metadata: Metadata = { title: 'Membership', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

function Bar({ share, label }: { share: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, share)) * 100)
  return (
    <div>
      <div className="flex justify-between text-xs text-ink-soft">
        <span>{label}</span>
        <span className="font-semibold text-heading">{pct}%</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full rounded-full bg-gold transition-[width] duration-700" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

export default async function MembershipPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const ct = await customerTier(user.id)
  if (!ct || !ct.enabled) redirect(`/${locale}/account/orders`)

  const money = (c: number) => formatMoney(c, locale)
  const date = (d: Date) =>
    new Intl.DateTimeFormat(locale === 'el' ? 'el-GR' : locale === 'ru' ? 'ru-RU' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric' }).format(d)
  const months = ct.config.windowMonths
  const currentIdx = TIER_KEYS.indexOf(ct.tier)

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold tracking-tight">{t('tier.title')}</h1>

      {/* ------------------------------------------------------ the card -- */}
      <section className="relative overflow-hidden rounded-3xl border border-line bg-[radial-gradient(120%_140%_at_100%_0%,rgb(255_212_59/0.16),transparent_55%),linear-gradient(160deg,#151515,#0b0b0b)] p-6 sm:p-8">
        <div aria-hidden className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full border border-accent/15" />
        <div aria-hidden className="pointer-events-none absolute -right-2 -top-2 h-32 w-32 rounded-full border border-accent/10" />
        <div className="relative">
          <TierBadge tier={ct.tier} size="lg" />
          <p className="mt-4 font-display text-[clamp(1.8rem,4vw,2.6rem)] font-semibold leading-tight text-heading">AIONIX {TIER_NAMES[ct.tier]}</p>
          <p className="mt-1 text-sm text-ink-soft">{TIER_TAGLINES[ct.tier][locale]}</p>
          <div className="mt-6 flex flex-wrap items-end gap-x-8 gap-y-3">
            <div>
              <p className="font-display text-4xl font-semibold text-accent">{ct.rule.discountPercent}%</p>
              <p className="text-xs text-muted">{ct.rule.discountPercent > 0 ? t('tier.offEvery', { percent: ct.rule.discountPercent }) : t('tier.basicNote')}</p>
            </div>
            {ct.manualUntil ? (
              <p className="text-xs text-ink-soft">{t('tier.manual', { date: date(ct.manualUntil) })}</p>
            ) : (
              ct.expiresAt && <p className="text-xs text-ink-soft">{t('tier.validUntil', { date: date(ct.expiresAt) })}</p>
            )}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- next and keep -- */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-line bg-paper-2 p-6">
          {ct.next ? (
            <>
              <h2 className="flex flex-wrap items-center gap-2 font-display text-lg font-semibold text-heading">
                {t('tier.toNext', { tier: TIER_NAMES[ct.next.key] })}
              </h2>
              <div className="mt-5 space-y-4">
                <Bar share={ct.next.progress.ordersShare} label={t('tier.ordersOf', { n: ct.stats.orders, total: ct.next.minOrders })} />
                <Bar share={ct.next.progress.spendShare} label={t('tier.spendOf', { n: money(ct.stats.spendCents), total: money(ct.next.minSpendCents) })} />
              </div>
              <p className="mt-5 text-sm text-ink">{t('tier.nextGets', { tier: TIER_NAMES[ct.next.key], percent: ct.next.discountPercent })}</p>
              <p className="mt-2 text-xs text-muted">{t('tier.window', { months })}</p>
            </>
          ) : (
            <div className="flex h-full flex-col items-start justify-center gap-4">
              <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full border border-accent/60 bg-accent/10 text-xl text-accent">★</span>
              <p className="font-display text-lg font-semibold text-heading">{t('tier.top')}</p>
            </div>
          )}
        </section>

        {ct.keep && ct.lower && ct.expiresAt && !ct.manualUntil && (
          <section className="rounded-2xl border border-line bg-paper-2 p-6">
            <h2 className="font-display text-lg font-semibold text-heading">{t('tier.keepTitle', { tier: TIER_NAMES[ct.tier] })}</h2>
            <p className="mt-5 text-xs text-muted">{t('tier.keptUntil')}</p>
            <p className="mt-1 font-display text-3xl font-semibold text-accent">{date(ct.expiresAt)}</p>
            <p className="mt-5 text-sm text-ink">
              {ct.keep.ordersNeeded > 1
                ? t('tier.keepMany', { n: ct.keep.ordersNeeded, tier: TIER_NAMES[ct.tier], months: ct.rule.durationMonths, lower: TIER_NAMES[ct.lower.key] })
                : t('tier.keepOne', { tier: TIER_NAMES[ct.tier], months: ct.rule.durationMonths, lower: TIER_NAMES[ct.lower.key] })}
            </p>
          </section>
        )}
      </div>

      {/* --------------------------------------------------------- ladder -- */}
      <section>
        <h2 className="label mb-4 text-muted">{t('tier.ladder')}</h2>
        <ol className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {ct.config.tiers.map((rule, i) => {
            const here = i === currentIdx
            const reached = i < currentIdx
            return (
              <li
                key={rule.key}
                className={`relative flex flex-col rounded-2xl border p-4 ${here ? 'border-accent bg-accent/5' : 'border-line bg-paper'} ${reached ? 'opacity-70' : ''}`}
              >
                {here && <span className="absolute -top-2.5 left-4 rounded-full bg-accent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-black">{t('tier.current')}</span>}
                <span className="self-start">
                  <TierBadge tier={rule.key} size="xs" />
                </span>
                <p className="mt-3 font-display text-2xl font-semibold text-heading">{rule.discountPercent}%</p>
                <p className="text-[11px] text-muted">{t('tier.off', { percent: rule.discountPercent })}</p>
                <p className="mt-3 text-xs text-ink-soft">
                  {rule.minOrders === 0 && rule.minSpendCents === 0
                    ? t('tier.reqNone')
                    : t('tier.req', { orders: rule.minOrders, spend: money(rule.minSpendCents) })}
                </p>
              </li>
            )
          })}
        </ol>
      </section>

      {/* ---------------------------------------------------- how it works -- */}
      <section className="rounded-2xl border border-line p-6">
        <h2 className="label mb-3 text-muted">{t('tier.how')}</h2>
        <ul className="space-y-2 text-sm text-ink-soft">
          {(['tier.how1', 'tier.how2', 'tier.how3', 'tier.how4'] as const).map((k) => (
            <li key={k} className="flex gap-2.5">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              {t(k, { months: k === 'tier.how3' || k === 'tier.how4' ? ct.rule.durationMonths : months })}
            </li>
          ))}
        </ul>
        <Link href={`/${locale}`} className="btn btn-primary mt-6">
          {t('cart.continueShopping')}
        </Link>
      </section>
    </div>
  )
}
