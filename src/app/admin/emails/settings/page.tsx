/* Marketing & Emails → Settings: the test address and the frequency limit. */

import { guardAdmin } from '@/lib/admin'
import { getSettings } from '@/lib/settings'
import { BRAND } from '@/config/brand'
import { emailEnabled } from '@/lib/email'
import { EmailSettingsForm } from '@/components/admin/EmailSettingsForm'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Email settings' }

export default async function EmailSettingsPage() {
  await guardAdmin('/admin/emails/settings')
  const s = await getSettings(['email_test_address', 'marketing_cooldown_hours', 'support_email'])
  return (
    <div className="max-w-2xl space-y-8">
      <EmailSettingsForm initial={{ testAddress: s.email_test_address, cooldownHours: s.marketing_cooldown_hours }} />
      <section className="border border-line bg-paper p-5 text-sm">
        <h2 className="font-medium">Sending</h2>
        <dl className="mt-3 grid gap-x-6 gap-y-2 text-muted sm:grid-cols-[auto_1fr]">
          <dt>Email service</dt>
          <dd>{emailEnabled ? 'Connected (EMAIL_API_KEY is set)' : 'Not connected, emails are logged, not sent'}</dd>
          <dt>Sent from</dt>
          <dd>{process.env.EMAIL_FROM || `${BRAND.name} <no-reply@example.com> (set EMAIL_FROM)`}</dd>
          <dt>New chats go to</dt>
          <dd>{s.support_email || BRAND.contact.email} (Settings → Customer service)</dd>
        </dl>
      </section>
    </div>
  )
}
