/* Shop settings — the values the storefront reads live. */

import { guardAdmin } from '@/lib/admin'
import { getSettings } from '@/lib/settings'
import { SettingsForm } from '@/components/admin/SettingsForm'
import { PageHead } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

export default async function AdminSettingsPage() {
  await guardAdmin('/admin/settings')

  const settings = await getSettings([
    'free_delivery_threshold_cents',
    'reservation_ttl_seconds',
    'vat_rate_bp',
    'low_stock_threshold',
    'max_qty_per_line',
    'estimated_delivery_min_days',
    'estimated_delivery_max_days',
    'homepage_promotions_enabled',
    'order_number_prefix',
    'support_email',
    'support_idle_minutes',
  ])

  return (
    <>
      <PageHead
        title="Settings"
        sub="Saved here and used by the shop straight away."
      />
      <SettingsForm initial={settings} />
    </>
  )
}
