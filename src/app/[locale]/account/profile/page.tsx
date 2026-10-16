import type { Metadata } from 'next'
import { eq } from 'drizzle-orm'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { db } from '@/db'
import { users } from '@/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { PasswordForm, ProfileForm } from '@/components/account/ProfileForms'
import { SignOutButton } from '@/components/auth/SignOutButton'
import { SmsPreference } from '@/components/account/SmsPreference'
import { smsStatusForUser } from '@/lib/sms-marketing'

export const metadata: Metadata = { title: 'My details', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function ProfilePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const [[u], sms] = await Promise.all([
    db.select({ locale: users.locale }).from(users).where(eq(users.id, user.id)),
    smsStatusForUser(user.id),
  ])

  return (
    <div className="space-y-12">
      <section>
        <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('acc.details')}</h1>
        <ProfileForm
          locale={locale}
          initial={{ firstName: user.firstName, lastName: user.lastName, phone: user.phone, email: user.email, locale: u?.locale ?? locale }}
        />
      </section>
      {sms && (
        <section className="border-t border-line pt-10">
          <h2 className="mb-4 text-lg font-semibold">{t('acc.smsTitle')}</h2>
          <SmsPreference locale={locale} phone={sms.phone} initial={sms.subscribed} />
        </section>
      )}
      <section className="border-t border-line pt-10">
        <h2 className="mb-6 text-lg font-semibold">{t('acc.changePassword')}</h2>
        <PasswordForm locale={locale} />
      </section>
      <section className="border-t border-line pt-8 lg:hidden">
        <SignOutButton locale={locale} />
      </section>
    </div>
  )
}
