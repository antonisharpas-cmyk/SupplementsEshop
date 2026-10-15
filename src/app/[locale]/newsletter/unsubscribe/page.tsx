/* The unsubscribe link in every marketing email lands here and asks for one
   press, a page that unsubscribed on opening would be triggered by the link
   scanners many mailboxes run. Mail clients with their own Unsubscribe button
   skip this page entirely (List-Unsubscribe-Post). */

import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { UnsubscribeButton } from '@/components/UnsubscribeButton'

export const metadata: Metadata = { title: 'Unsubscribe', robots: { index: false, follow: false } }

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> }

export default async function UnsubscribePage({ params, searchParams }: Props) {
  const { locale: raw } = await params
  const { token } = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  return (
    <div className="container-x py-20 md:py-28">
      <div className="mx-auto max-w-lg text-center">
        <UnsubscribeButton locale={locale} token={token ?? ''} />
      </div>
    </div>
  )
}
