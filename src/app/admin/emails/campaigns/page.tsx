/* ============================================================================
 * Marketing & Emails → Campaigns: new-arrival and promotion mailings to
 * newsletter subscribers. Nothing is mailed automatically when a product is
 * added — every mailing is written and sent (or scheduled) here.
 * ========================================================================== */

import { guardAdmin } from '@/lib/admin'
import { audienceSizes, campaignPickerProducts, listCampaigns } from '@/lib/newsletter'
import { getCategoryTree, t as tField } from '@/lib/catalog'
import { getSettings } from '@/lib/settings'
import { CampaignComposer } from '@/components/admin/CampaignComposer'
import { CampaignCancel } from '@/components/admin/CampaignCancel'
import { Pill } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Campaigns' }

const when = (d: Date | null) =>
  d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Nicosia' }) : '—'

export default async function CampaignsPage() {
  await guardAdmin('/admin/emails/campaigns')
  const [sizes, campaigns, products, tree, settings] = await Promise.all([
    audienceSizes(),
    listCampaigns(),
    campaignPickerProducts(),
    getCategoryTree(),
    getSettings(['email_test_address', 'marketing_cooldown_hours']),
  ])
  const categories = tree.flatMap((root) => [
    { id: root.id, label: tField(root.name, 'en') },
    ...root.children.map((c) => ({ id: c.id, label: `${tField(root.name, 'en')} › ${tField(c.name, 'en')}` })),
  ])
  const sending = campaigns.some((c) => c.status === 'SENDING')

  return (
    <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
      <section className="border border-line bg-paper p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">New mailing</h2>
        <p className="mb-5 mt-1 text-sm text-muted">
          To confirmed subscribers only. Anyone who had a marketing email in the last {settings.marketing_cooldown_hours} hours is
          skipped for this one (Settings).
        </p>
        <CampaignComposer
          audience={sizes}
          sending={sending}
          products={products}
          categories={categories}
          testAddress={settings.email_test_address}
        />
      </section>

      <section className="border border-line bg-paper p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Mailings</h2>
        {campaigns.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-[var(--color-line)] text-sm">
            {campaigns.map((c) => {
              const content = (c.content ?? {}) as { audience?: string; promoCode?: string }
              return (
                <li key={c.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1 py-3">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.subject}</span>
                    <span className="text-xs text-muted">
                      {c.kind === 'promotion' ? 'Promotion' : 'New arrivals'}
                      {content.audience && content.audience !== 'all' && ` · ${content.audience.toUpperCase()} only`}
                      {content.promoCode && ` · code ${content.promoCode}`} ·{' '}
                      {c.status === 'SCHEDULED' ? `for ${when(c.scheduledAt)}` : when(c.startedAt ?? c.createdAt)}
                    </span>
                  </span>
                  <span className="text-right text-xs tabular-nums">
                    {c.status === 'SCHEDULED' ? (
                      <span className="flex items-center gap-3">
                        <Pill tone="warn">Scheduled · {c.recipientCount}</Pill>
                        <CampaignCancel id={c.id} />
                      </span>
                    ) : c.status === 'SENDING' ? (
                      <Pill tone="warn">
                        Sending {c.sentCount + c.failedCount + c.skippedCount}/{c.recipientCount}
                      </Pill>
                    ) : c.status === 'CANCELLED' ? (
                      <Pill tone="off">Cancelled</Pill>
                    ) : (
                      <>
                        {c.sentCount} sent
                        {c.skippedCount > 0 && <span className="ml-2 text-muted">{c.skippedCount} skipped (frequency)</span>}
                        {c.failedCount > 0 && <span className="ml-2 text-sale">{c.failedCount} failed</span>}
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </section>
    </div>
  )
}
