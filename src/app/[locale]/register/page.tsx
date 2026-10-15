/* Create an account. */

import { redirect } from 'next/navigation'
import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getCurrentUser } from '@/lib/auth/session'
import { RegisterForm } from '@/components/auth/RegisterForm'

export const metadata: Metadata = {
  title: 'Create an account',
  robots: { index: false, follow: false },
}

export default async function RegisterPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale

  const user = await getCurrentUser()
  if (user) redirect(`/${locale}/account`)

  return <RegisterForm locale={locale} />
}
