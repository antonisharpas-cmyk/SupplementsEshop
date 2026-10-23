'use client'

/* Small pieces every finance form uses: euros typed as text to cents and
   back, one way to call the API, and photo shrinking before upload. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** "12,50", "1.234,50", "12.5" → 1250. Empty → null. */
export function toCents(raw: string): number | null {
  let s = raw.replace(/[€\s ]/g, '')
  if (!s) return null
  const c = s.lastIndexOf(',')
  const d = s.lastIndexOf('.')
  if (c > d) s = s.replace(/\./g, '').replace(',', '.')
  else s = s.replace(/,/g, '')
  const n = Number(s)
  return Number.isFinite(n) ? Math.round(n * 100) : null
}

export const euros = (cents: number | null | undefined) => (cents === null || cents === undefined ? '' : (cents / 100).toFixed(2))

export const fmt = (cents: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(cents / 100)

export type Msg = { ok: boolean; text: string } | null

/** Call a JSON route; refresh the page on success. */
export function useApi() {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<Msg>(null)
  async function call<T = Record<string, unknown>>(url: string, method: string, body?: unknown, opts: { refresh?: boolean; okText?: string } = {}) {
    setBusy(true)
    setMsg(null)
    try {
      const res = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string } & T
      if (res.ok && data.ok) {
        if (opts.okText) setMsg({ ok: true, text: opts.okText })
        if (opts.refresh !== false) router.refresh()
        return data
      }
      setMsg({ ok: false, text: data.message ?? 'That did not work.' })
      return null
    } catch {
      setMsg({ ok: false, text: 'Could not reach the server.' })
      return null
    } finally {
      setBusy(false)
    }
  }
  return { busy, msg, setMsg, call, router }
}

/** Photos are made smaller in the browser (longest side 1800 px, JPEG):
 *  a receipt stays readable at a fraction of the size. PDFs go as they are. */
export async function shrink(file: File): Promise<File> {
  if (!/^image\/(jpeg|png|webp)$/.test(file.type) || file.size < 400_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.78))
    if (!blob || blob.size >= file.size) return file
    return new File([blob], file.name.replace(/\.(png|webp|jpe?g)$/i, '') + '.jpg', { type: 'image/jpeg' })
  } catch {
    return file
  }
}

export async function uploadFiles(type: string, id: string, files: FileList | File[]) {
  const form = new FormData()
  for (const f of Array.from(files).slice(0, 10)) form.append('file', await shrink(f))
  const res = await fetch(`/api/admin/finance/files?type=${type}&id=${id}`, { method: 'POST', body: form })
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string }
  return res.ok && data.ok ? null : (data.message ?? 'The file did not upload.')
}

export const PAY_METHODS = [
  ['bank', 'Bank transfer'],
  ['card', 'Card'],
  ['cash', 'Cash'],
  ['other', 'Other'],
] as const

export const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia' }).format(new Date())
