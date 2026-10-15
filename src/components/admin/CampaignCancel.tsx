'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** "Cancel" on a scheduled mailing that has not started. */
export function CampaignCancel({ id }: { id: string }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const res = await fetch(`/api/admin/newsletter/campaigns/${id}/cancel`, { method: 'POST' }).catch(() => null)
          const data = (await res?.json().catch(() => ({}))) as { ok?: boolean; message?: string } | undefined
          setBusy(false)
          if (!res?.ok || !data?.ok) setError(data?.message ?? 'Could not cancel.')
          else router.refresh()
        }}
        className="underline hover:no-underline disabled:opacity-50"
      >
        {busy ? 'Cancelling…' : 'Cancel'}
      </button>
      {error && (
        <span role="alert" className="block text-sale">
          {error}
        </span>
      )}
    </>
  )
}
