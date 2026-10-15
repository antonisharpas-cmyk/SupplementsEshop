'use client'

/* Sign out. A POST, because a GET link would be triggered by any prefetch or
   embedded image and log people out at random. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { Locale } from '@/config/brand'
import { getTranslator } from '@/i18n/messages'

export function SignOutButton({ locale }: { locale: Locale }) {
  const t = getTranslator(locale)
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true)
        try {
          await fetch('/api/auth/logout', { method: 'POST' })
        } finally {
          router.push(`/${locale}`)
          router.refresh()
        }
      }}
      className="text-sm text-muted underline hover:text-ink disabled:opacity-40"
    >
      {t('auth.signOut')}
    </button>
  )
}
