/* ============================================================================
 * SMS through sms.to.
 *
 *   SMSTO_API_KEY     the API key from the sms.to dashboard (API Clients)
 *   SMSTO_SENDER_ID   the name the message comes from, up to 11 letters and
 *                     digits, e.g. AIONIX. Register it with sms.to first.
 *
 * Without SMSTO_API_KEY nothing is sent: messages are written to the server
 * log, so the admin can be tried out on a laptop.
 *
 * Only the marketing campaigns use this today (lib/sms-marketing.ts).
 * ========================================================================== */

const API = 'https://api.sms.to'
const API_KEY = process.env.SMSTO_API_KEY?.trim()
export const SMS_SENDER_ID = (process.env.SMSTO_SENDER_ID?.trim() || 'AIONIX').slice(0, 11)
export const smsEnabled = Boolean(API_KEY)

/** sms.to takes at most this many numbers per request. */
export const SMS_BATCH = 1000

export { smsLength, type SmsLength } from '@/lib/sms-length'

/* ----------------------------------------------------------------- send -- */

export type SmsResult =
  | { ok: true; ref?: string; logged?: boolean }
  | { ok: false; error: string }

async function call(path: string, body: unknown, base = API): Promise<{ ok: boolean; status: number; data: Record<string, unknown> | null; text: string }> {
  const res = await fetch(`${base}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data: Record<string, unknown> | null = null
  try {
    data = JSON.parse(text) as Record<string, unknown>
  } catch {
    /* not JSON */
  }
  return { ok: res.ok, status: res.status, data, text }
}

function errorOf(r: { status: number; data: Record<string, unknown> | null; text: string }) {
  const m = r.data?.message ?? r.data?.error ?? r.text
  return `sms.to ${r.status}: ${String(typeof m === 'string' ? m : JSON.stringify(m)).slice(0, 300)}`
}

/** One message to one or many numbers (up to SMS_BATCH). */
export async function sendSms(to: string[], message: string): Promise<SmsResult> {
  if (to.length === 0) return { ok: true }
  if (to.length > SMS_BATCH) throw new Error(`At most ${SMS_BATCH} numbers per request.`)
  if (!API_KEY) {
    console.info(
      `\n──── SMS (not sent: SMSTO_API_KEY is unset) ────\n` +
        `from: ${SMS_SENDER_ID}\nto:   ${to.length === 1 ? to[0] : `${to.length} numbers`}\n\n${message}\n` +
        `────────────────────────────────────────────────\n`,
    )
    return { ok: true, logged: true }
  }
  try {
    const r = await call('/sms/send', {
      message,
      to: to.length === 1 ? to[0] : to,
      sender_id: SMS_SENDER_ID,
      /* Respect sms.to's own opt out list as well as ours. */
      bypass_optout: false,
    })
    if (!r.ok || r.data?.success === false) return { ok: false, error: errorOf(r) }
    const ref = (r.data?.message_id ?? r.data?.campaign_id ?? r.data?.id) as string | undefined
    return { ok: true, ref: ref ? String(ref) : undefined }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** What sms.to says sending this would cost, before sending it. */
export async function estimateSms(to: string[], message: string): Promise<{ ok: true; cost: number | null; detail: string } | { ok: false; error: string }> {
  if (!API_KEY) return { ok: false, error: 'SMS is not connected yet (SMSTO_API_KEY is not set).' }
  if (to.length === 0) return { ok: true, cost: 0, detail: 'No recipients.' }
  let total = 0
  let found = false
  try {
    for (let i = 0; i < to.length; i += SMS_BATCH) {
      const batch = to.slice(i, i + SMS_BATCH)
      const r = await call('/sms/estimate', { message, to: batch.length === 1 ? batch[0] : batch, sender_id: SMS_SENDER_ID })
      if (!r.ok) return { ok: false, error: errorOf(r) }
      const raw = r.data?.estimated_cost ?? r.data?.cost ?? (r.data?.data as Record<string, unknown> | undefined)?.estimated_cost
      const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
      if (Number.isFinite(n)) {
        total += n
        found = true
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
  return { ok: true, cost: found ? Math.round(total * 10_000) / 10_000 : null, detail: found ? '' : 'sms.to did not return a price.' }
}

/** The account balance, for the admin page. Null when unknown. */
export async function smsBalance(): Promise<{ balance: number; currency: string } | null> {
  if (!API_KEY) return null
  try {
    const r = await call('/api/balance', undefined, 'https://auth.sms.to')
    if (!r.ok || !r.data) return null
    const b = Number(r.data.balance)
    return Number.isFinite(b) ? { balance: b, currency: String(r.data.currency ?? 'EUR') } : null
  } catch {
    return null
  }
}
