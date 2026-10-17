'use client'

/* Something failed while showing a page: say so in the visitor's language
   and offer to try again, instead of a blank screen. */

import { useEffect } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

const AGAIN: Record<Locale, string> = { en: 'Try again', el: 'Δοκίμασε ξανά', ru: 'Попробовать снова' }
const HOME: Record<Locale, string> = { en: 'Back to the shop', el: 'Πίσω στο κατάστημα', ru: 'Вернуться в магазин' }

export default function LocaleError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const seg = usePathname()?.split('/')[1] ?? 'en'
  const locale: Locale = isLocale(seg) ? seg : 'en'
  const t = getTranslator(locale)
  useEffect(() => {
    console.error(error)
  }, [error])
  return (
    <div className="container-x grid min-h-[50vh] place-items-center py-20 text-center">
      <div>
        <h1 className="font-display text-3xl font-semibold tracking-tight text-heading">{t('err.generic')}</h1>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <button type="button" onClick={reset} className="btn btn-primary">
            {AGAIN[locale]}
          </button>
          <Link href={`/${locale}`} className="btn btn-secondary">
            {HOME[locale]}
          </Link>
        </div>
      </div>
    </div>
  )
}
