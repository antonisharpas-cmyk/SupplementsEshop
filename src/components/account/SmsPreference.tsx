'use client'

/* My details → Offers by SMS: one switch, for the phone on the account. */

import { useState } from 'react'
import { getTranslator } from '@/i18n/messages'
import type { Locale } from '@/config/brand'
import { button } from '@/components/ui'

export function SmsPreference({ locale, phone, initial }: { locale: Locale; phone: string; initial: boolean }) {
  const t = getTranslator(locale)
  const [on, setOn] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  async function toggle() {
    setBusy(true)
    setMsg(null)
    const res = await fetch('/api/account/sms', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscribed: !on, locale }),
    }).catch(() => null)
    const data = (await res?.json().catch(() => null)) as { ok?: boolean; message?: string } | null
    setBusy(false)
    if (res?.ok && data?.ok) {
      setOn(!on)
      setMsg({ ok: true, text: t('acc.smsSaved') })
    } else {
      setMsg({ ok: false, text: data?.message ?? t('co.fixErrors') })
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-line bg-paper-2 px-5 py-4">
      <p className="text-sm text-ink-soft">{on ? t('acc.smsOn', { phone }) : t('acc.smsOff')}</p>
      <div className="flex items-center gap-3">
        {msg && <span className={`text-xs ${msg.ok ? 'text-ok' : 'text-sale'}`}>{msg.text}</span>}
        <button type="button" onClick={toggle} disabled={busy} className={on ? button.quiet : `${button.primary} btn-sm`}>
          {on ? t('acc.smsUnsubscribe') : t('acc.smsSubscribe')}
        </button>
      </div>
    </div>
  )
}
