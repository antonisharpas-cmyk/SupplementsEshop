/* Admin → My account: your own details and password. Everyone changes only
   their own; no screen lets one admin set another admin's password. */

import { guardAdmin } from '@/lib/admin'
import { PageHead } from '@/components/admin/ui'
import { PasswordForm } from '@/components/account/ProfileForms'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'My account' }

export default async function AdminAccountPage() {
  const user = await guardAdmin('/admin/account')
  return (
    <>
      <PageHead title="My account" sub="Your own sign in details. Nobody else can change your password, and you cannot change anyone else's." />
      <section className="mb-6 max-w-xl rounded-2xl border border-line bg-paper p-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-[8rem_1fr]">
          <dt className="text-muted">Name</dt>
          <dd className="text-heading">{`${user.firstName} ${user.lastName}`.trim()}</dd>
          <dt className="text-muted">Email</dt>
          <dd className="text-heading">{user.email}</dd>
          <dt className="text-muted">Access</dt>
          <dd className="text-heading">{user.role === 'SUPER_ADMIN' ? 'Support (full access)' : 'Admin (full access)'}</dd>
        </dl>
      </section>
      <section className="max-w-xl rounded-2xl border border-line bg-paper p-6">
        <h2 className="mb-1 text-lg font-semibold">Change password</h2>
        <p className="mb-5 text-sm text-muted">At least 10 characters. Other devices signed in with this account are signed out.</p>
        <PasswordForm locale="en" />
      </section>
    </>
  )
}
