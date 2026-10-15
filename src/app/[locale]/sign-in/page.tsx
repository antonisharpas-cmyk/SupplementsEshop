/* Sign in. Already signed in? There is nothing here for you — go to the
   account page rather than showing a form that would confuse. */

import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getCurrentUser } from '@/lib/auth/session'
import { SignInForm } from '@/components/auth/SignInForm'

export const metadata: Metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
}

export default async function SignInPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>
  searchParams: Promise<{ next?: string }>
}) {
  const { locale: raw } = await params
  const { next } = await searchParams
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale

  const user = await getCurrentUser()
  if (user) redirect(`/${locale}/account`)

  return <SignInForm locale={locale} next={next} />
}
