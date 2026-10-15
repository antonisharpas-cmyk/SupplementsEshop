/* Admin → Marketing & Emails: every email the shop sends, in one place. */

import { EmailTabs } from '@/components/admin/EmailTabs'
import { emailEnabled } from '@/lib/email'

export default function EmailsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Marketing &amp; Emails</h1>
        <p className="mt-1 text-sm text-muted">
          Automated emails, mailings to subscribers, and a record of everything sent.
        </p>
        {!emailEnabled && (
          <p className="mt-3 border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs text-amber-800">
            No email service is configured (EMAIL_API_KEY), so emails are written to the server log and Email activity
            instead of being sent.
          </p>
        )}
      </div>
      <EmailTabs />
      {children}
    </>
  )
}
