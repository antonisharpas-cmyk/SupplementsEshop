/* ============================================================================
 * /link: the one address for the Instagram bio (and a WhatsApp message, or a
 * QR code on the counter). The shop's logo, a few big buttons, the address.
 *
 * Unlisted, not secret: nothing on the site links here, it is not in the
 * sitemap and it asks search engines not to index it. It only shows what is
 * public anyway.
 *
 * Language: ?lang=el or ?lang=ru, otherwise the visitor's saved shop language,
 * otherwise their browser's, otherwise English. Buttons go to the shop in the
 * same language.
 *
 * Social buttons appear on their own once the accounts are filled in
 * src/config/brand.ts (social.instagram, facebook, tiktok, contact.whatsapp).
 * ========================================================================== */

import type { Metadata } from 'next'
import { cookies, headers } from 'next/headers'
import { BRAND, DEFAULT_LOCALE, LOCALES, isLocale, type Locale } from '@/config/brand'

const BASE = (process.env.PUBLIC_SITE_URL ?? '').replace(/\/$/, '')

export const metadata: Metadata = {
  title: `${BRAND.name} · Supplement Store Cyprus`,
  description: 'Protein, creatine, pre workout and vitamins, delivered across Cyprus.',
  robots: { index: false, follow: false },
  openGraph: {
    title: BRAND.name,
    description: 'Supplement Store · Delivered across Cyprus',
    images: BASE ? [`${BASE}${BRAND.logo.full}`] : undefined,
  },
}

const WORDS: Record<Locale, Record<string, string>> = {
  en: {
    tagline: 'Supplements delivered across Cyprus',
    shop: 'Shop now',
    offers: 'Offers',
    newIn: 'New arrivals',
    call: 'Call us',
    whatsapp: 'WhatsApp',
    email: 'Email us',
    builtBy: 'Developed & Designed by',
    mantra: 'FUEL YOUR GOALS|TRAIN HARDER|RECOVER STRONGER|DELIVERED ACROSS CYPRUS',
  },
  el: {
    tagline: 'Συμπληρώματα με παράδοση σε όλη την Κύπρο',
    shop: 'Αγόρασε τώρα',
    offers: 'Προσφορές',
    newIn: 'Νέες αφίξεις',
    call: 'Καλέστε μας',
    whatsapp: 'WhatsApp',
    email: 'Στείλτε μας email',
    builtBy: 'Ανάπτυξη & σχεδιασμός από',
    mantra:
      'ΠΕΤΥΧΕ ΤΟΥΣ ΣΤΟΧΟΥΣ ΣΟΥ|ΠΡΟΠΟΝΗΣΟΥ ΠΙΟ ΔΥΝΑΤΑ|ΑΝΑΚΑΜΨΕ ΓΡΗΓΟΡΑ|ΠΑΡΑΔΟΣΗ ΣΕ ΟΛΗ ΤΗΝ ΚΥΠΡΟ',
  },
  ru: {
    tagline: 'Спортивное питание с доставкой по Кипру',
    shop: 'В магазин',
    offers: 'Акции',
    newIn: 'Новинки',
    call: 'Позвонить',
    whatsapp: 'WhatsApp',
    email: 'Написать нам',
    builtBy: 'Разработка и дизайн',
    mantra: 'К ТВОИМ ЦЕЛЯМ|ТРЕНИРУЙСЯ СИЛЬНЕЕ|ВОССТАНАВЛИВАЙСЯ БЫСТРЕЕ|ДОСТАВКА ПО КИПРУ',
  },
}

const LOCALE_NAMES: Record<Locale, string> = { en: 'EN', el: 'ΕΛ', ru: 'RU' }

async function pickLocale(lang: string | undefined): Promise<Locale> {
  if (lang && isLocale(lang)) return lang
  const saved = (await cookies()).get('sf_locale')?.value
  if (saved && isLocale(saved)) return saved
  const header = (await headers()).get('accept-language') ?? ''
  for (const part of header.split(',')) {
    const base = part.trim().split(';')[0].split('-')[0].toLowerCase()
    if (isLocale(base)) return base
  }
  return DEFAULT_LOCALE
}

/* ---------------------------------------------------------------- icons -- */
const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const
const Icon = {
  bag: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M6 7h12l-1 13H7L6 7Z" />
      <path d="M9 7a3 3 0 0 1 6 0" />
    </svg>
  ),
  tag: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M3 12V4h8l10 10-8 8L3 12Z" />
      <circle cx="7.5" cy="8.5" r="1.3" />
    </svg>
  ),
  spark: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" />
    </svg>
  ),
  instagram: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.2" cy="6.8" r="0.6" fill="currentColor" />
    </svg>
  ),
  facebook: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <circle cx="12" cy="12" r="9" />
      <path d="M13.5 8.5h-1a1.5 1.5 0 0 0-1.5 1.5v11M9 13h5" />
    </svg>
  ),
  tiktok: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M14 3v11.5a3.5 3.5 0 1 1-3.5-3.5" />
      <path d="M14 3c.4 2.6 2.2 4.3 5 4.5" />
    </svg>
  ),
  phone: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M5 4h3.5l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5L16 14l4 1.5V19a1.5 1.5 0 0 1-1.6 1.5A16 16 0 0 1 3.5 5.6 1.5 1.5 0 0 1 5 4Z" />
    </svg>
  ),
  whatsapp: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <path d="M4 20l1.3-3.9A8.5 8.5 0 1 1 8 19l-4 1Z" />
      <path d="M9 9.5c.3 2.3 2.2 4.2 4.5 4.5l1-1.2 1.8.8-.3 1.3c-3.3.4-7-3.3-6.6-6.6l1.3-.3.8 1.8L9 9.5Z" />
    </svg>
  ),
  mail: (
    <svg viewBox="0 0 24 24" className="size-[18px]" {...stroke}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 6 8.5 7 8.5-7" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
      <path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.5" />
    </svg>
  ),
}

function Mantra({ text, reverse }: { text: string; reverse?: boolean }) {
  const items = text.split('|')
  const row = (hidden?: boolean) => (
    <ul aria-hidden={hidden} className="flex shrink-0 items-center gap-3">
      {[...items, ...items].map((m, i) => (
        <li key={i} className="flex items-center gap-3 whitespace-nowrap">
          <span className="font-display text-[11px] font-semibold tracking-[0.3em] text-muted">
            {m}
          </span>
          <span className="size-1.5 rounded-full bg-accent" />
        </li>
      ))}
    </ul>
  )
  return (
    <div
      className="marquee overflow-hidden border-line bg-paper py-3"
      style={{
        ['--marquee-duration' as string]: '40s',
        ['--marquee-direction' as string]: reverse ? 'reverse' : 'normal',
      }}
    >
      <div className="marquee-track flex gap-3">
        {row()}
        {row(true)}
      </div>
    </div>
  )
}

export default async function LinkPage({
  searchParams,
}: {
  searchParams: Promise<{ lang?: string }>
}) {
  const locale = await pickLocale((await searchParams).lang)
  const w = WORDS[locale]
  const shop = `/${locale}`
  const { social, contact } = BRAND
  const tel = contact.phone.replace(/[^\d+]/g, '')
  const wa = contact.whatsapp.replace(/\D/g, '')

  const buttons: {
    href: string
    label: string
    icon: React.ReactNode
    primary?: boolean
    external?: boolean
  }[] = [
    { href: shop, label: w.shop, icon: Icon.bag, primary: true },
    { href: `${shop}/sale`, label: w.offers, icon: Icon.tag },
    { href: `${shop}/new`, label: w.newIn, icon: Icon.spark },
    ...(social.instagram
      ? [{ href: social.instagram, label: 'Instagram', icon: Icon.instagram, external: true }]
      : []),
    ...(social.facebook
      ? [{ href: social.facebook, label: 'Facebook', icon: Icon.facebook, external: true }]
      : []),
    ...(social.tiktok
      ? [{ href: social.tiktok, label: 'TikTok', icon: Icon.tiktok, external: true }]
      : []),
    ...(wa
      ? [{ href: `https://wa.me/${wa}`, label: w.whatsapp, icon: Icon.whatsapp, external: true }]
      : []),
    { href: `tel:${tel}`, label: w.call, icon: Icon.phone },
    { href: `mailto:${contact.email}`, label: w.email, icon: Icon.mail },
  ]

  return (
    <div lang={locale} className="flex min-h-dvh flex-col">
      <Mantra text={w.mantra} />

      <main
        className="relative flex flex-1 flex-col items-center px-4 pb-10 pt-10 sm:pt-14"
        style={{
          backgroundImage:
            'radial-gradient(60% 45% at 50% 0%, rgb(255 212 59 / 0.10), transparent 70%)',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={BRAND.logo.full}
          alt={BRAND.name}
          width={800}
          height={454}
          className="h-24 w-auto sm:h-28"
        />
        <p className="mt-4 text-center text-base text-heading sm:text-lg">{w.tagline}</p>

        <nav className="mt-7 flex w-full max-w-md flex-col gap-3">
          {buttons.map((b) => (
            <a
              key={b.href}
              href={b.href}
              {...(b.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
              className={`btn h-14 w-full !text-[13px] !font-semibold uppercase !tracking-[0.18em] ${b.primary ? 'btn-primary' : 'btn-secondary'}`}
            >
              <span className={b.primary ? '' : 'text-accent'}>{b.icon}</span>
              {b.label}
            </a>
          ))}
        </nav>

        <div className="mt-8 flex flex-col items-center gap-1.5 text-center">
          <span className="text-accent">{Icon.pin}</span>
          <p className="label !tracking-[0.2em] text-muted">{contact.addressLines.join(', ')}</p>
        </div>

        <div className="mt-6 flex gap-1.5" aria-label="Language">
          {LOCALES.map((l) => (
            <a
              key={l}
              href={`/link?lang=${l}`}
              aria-current={l === locale ? 'true' : undefined}
              className={`rounded-full border px-3 py-1 text-[11px] font-semibold tracking-wider transition-colors ${
                l === locale ? 'border-accent text-accent' : 'border-line text-muted hover:text-ink'
              }`}
            >
              {LOCALE_NAMES[l]}
            </a>
          ))}
        </div>

        <a
          href="https://www.ergonsite.com"
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${w.builtBy} ErgonSite`}
          className="group mt-8 flex items-center gap-2.5 opacity-70 transition-opacity hover:opacity-100"
        >
          <span className="whitespace-nowrap text-xs text-muted group-hover:text-ink">
            {w.builtBy}
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/brand/ergonsite.png"
            alt="ErgonSite"
            width={480}
            height={104}
            className="h-auto w-[84px]"
          />
        </a>
      </main>

      <Mantra text={w.mantra} reverse />
    </div>
  )
}
