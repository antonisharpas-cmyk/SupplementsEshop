import type { Metadata } from 'next'
import { desc, eq } from 'drizzle-orm'
import { BRAND, isLocale, type Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'
import { db } from '@/db'
import { addresses } from '@/db/schema'
import { getCurrentUser } from '@/lib/auth/session'
import { AddressBook } from '@/components/account/AddressBook'

export const metadata: Metadata = { title: 'Addresses', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function AddressesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params
  const locale = (isLocale(raw) ? raw : BRAND.market.defaultLocale) as Locale
  const t = getTranslator(locale)
  const user = (await getCurrentUser())!
  const rows = await db.select().from(addresses).where(eq(addresses.userId, user.id)).orderBy(desc(addresses.isDefault), desc(addresses.createdAt))
  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{t('acc.addresses')}</h1>
      <AddressBook
        locale={locale}
        name={`${user.firstName} ${user.lastName}`}
        phone={user.phone}
        items={rows.map((r) => ({
          id: r.id,
          label: r.label,
          recipientName: r.recipientName,
          phone: r.phone,
          line1: r.line1,
          line2: r.line2,
          city: r.city,
          postalCode: r.postalCode,
          country: r.country,
          isDefault: r.isDefault,
        }))}
      />
    </div>
  )
}
