/* The link at the end of every SMS offer: type the number, press once. */

import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { SmsStopForm } from '@/components/SmsStopForm'

export const metadata: Metadata = { title: 'Stop SMS offers', robots: { index: false, follow: false } }

export default async function SmsStopPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  return (
    <div className="container-x py-20 md:py-28">
      <div className="mx-auto max-w-md">
        <h1 className="text-3xl">{t('sms.stopTitle')}</h1>
        <p className="mt-3 text-ink-soft">{t('sms.stopBody')}</p>
        <SmsStopForm locale={locale} />
      </div>
    </div>
  )
}
