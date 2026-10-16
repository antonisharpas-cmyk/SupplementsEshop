/* The account opens on Orders: the overview page was retired, its hello and
   member date now sit at the top of the account menu. */

import { redirect } from 'next/navigation'

export default async function AccountPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params
  redirect(`/${locale}/account/orders`)
}
