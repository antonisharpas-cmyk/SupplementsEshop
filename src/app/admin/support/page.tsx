/* Customer Service: every conversation from the shop's chat, newest activity
   first. The page renders the first view; the inbox keeps itself current. */

import { guardAdmin } from '@/lib/admin'
import { inboxCounts, listInbox, SERVICE_NAME, staffThread } from '@/lib/support'
import { getSettings } from '@/lib/settings'
import { BRAND } from '@/config/brand'
import { SupportInbox } from '@/components/admin/SupportInbox'
import { SupportAutoReply } from '@/components/admin/SupportAutoReply'
import { PageHead } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function AdminSupportPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; status?: string }>
}) {
  await guardAdmin('/admin/support')
  const sp = await searchParams
  const status = sp.status === 'CLOSED' || sp.status === 'ALL' ? sp.status : 'OPEN'
  const [list, counts, thread, settings] = await Promise.all([
    listInbox({ status }),
    inboxCounts(),
    sp.c && UUID.test(sp.c) ? staffThread(sp.c, { markRead: true }) : Promise.resolve(null),
    getSettings([
      'support_email',
      'support_idle_minutes',
      'support_auto_reply_enabled',
      'support_auto_reply_en',
      'support_auto_reply_el',
      'support_auto_reply_ru',
    ]),
  ])

  return (
    <>
      <PageHead
        title="Customer Service"
        sub={
          <>
            Chats from the shop. New conversations are also emailed to{' '}
            <strong className="font-medium">{settings.support_email || BRAND.contact.email}</strong>; quiet ones close after{' '}
            {settings.support_idle_minutes} minutes (change both in Settings).
          </>
        }
      />
      <SupportAutoReply
        initial={{
          enabled: settings.support_auto_reply_enabled,
          en: settings.support_auto_reply_en,
          el: settings.support_auto_reply_el,
          ru: settings.support_auto_reply_ru,
        }}
      />
      <SupportInbox
        key={status}
        initialStatus={status}
        initialRows={list.rows}
        initialCounts={counts}
        initialThread={thread}
        serviceName={SERVICE_NAME}
      />
    </>
  )
}
