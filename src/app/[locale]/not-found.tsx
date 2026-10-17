/* A missing product or page, inside the shop's own header and footer and in
   the visitor's language. */

import Link from 'next/link'
import { cookies } from 'next/headers'
import { isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

const BACK: Record<Locale, string> = { en: 'Back to the shop', el: 'Πίσω στο κατάστημα', ru: 'Вернуться в магазин' }

export default async function LocaleNotFound() {
  const saved = (await cookies()).get('sf_locale')?.value ?? 'en'
  const locale: Locale = isLocale(saved) ? saved : 'en'
  const t = getTranslator(locale)
  return (
    <div className="container-x grid min-h-[50vh] place-items-center py-20 text-center">
      <div>
        <p className="label text-accent">404</p>
        <h1 className="mt-3 font-display text-3xl font-semibold tracking-tight text-heading">{t('err.notFound')}</h1>
        <Link href={`/${locale}`} className="btn btn-primary mt-8">
          {BACK[locale]}
        </Link>
      </div>
    </div>
  )
}
