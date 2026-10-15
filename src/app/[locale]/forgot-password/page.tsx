import type { Metadata } from 'next'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'

export const metadata: Metadata = { title: 'Reset password', robots: { index: false, follow: false } }

export default async function ForgotPasswordPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  return <ForgotPasswordForm locale={locale} />
}
