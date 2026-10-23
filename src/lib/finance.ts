/* ============================================================================
 * Shared pieces of the finance area: VAT treatments, months, closed books,
 * document numbers and the files kept with records.
 * ========================================================================== */

import { and, asc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '@/db'
import { attachments, media } from '@/db/schema'
import { getSettings } from '@/lib/settings'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export class FinanceError extends Error {}

export const TZ = 'Europe/Nicosia'

/* ------------------------------------------------------------------ VAT -- */

export const VAT_TREATMENTS = {
  DOMESTIC: { label: 'Cyprus VAT', hint: 'VAT on the invoice, reclaimed' },
  EU_REVERSE: { label: 'EU reverse charge', hint: 'No VAT on the invoice: VAT due and reclaimed at the same time' },
  IMPORT: { label: 'Import from outside the EU', hint: 'Import VAT and duty paid on arrival' },
  NONE: { label: 'No VAT', hint: 'Not VAT registered, or VAT that cannot be reclaimed (part of the cost)' },
} as const
export type VatTreatment = keyof typeof VAT_TREATMENTS
export const isVatTreatment = (v: unknown): v is VatTreatment => typeof v === 'string' && v in VAT_TREATMENTS

/** VAT on an amount before VAT, rounded to the cent. */
export const vatOn = (netCents: number, rateBp: number) => Math.round((netCents * rateBp) / 10_000)

/* --------------------------------------------------------------- dates -- */

/** Today in Cyprus as YYYY-MM-DD. */
export const todayCy = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d)
/** YYYY-MM of a date (Cyprus time) or of a YYYY-MM-DD string. */
export const monthOf = (d: Date | string) => (typeof d === 'string' ? d.slice(0, 7) : todayCy(d).slice(0, 7))

export const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`))
export const isMonth = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s)

/** First day and the day after the last day of a month, as YYYY-MM-DD. */
export function monthRange(month: string): { from: string; toExclusive: string } {
  const [y, m] = month.split('-').map(Number)
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`
  return { from: `${month}-01`, toExclusive: `${next}-01` }
}

export function addDays(day: string, n: number) {
  const d = new Date(`${day}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export const monthName = (month: string) =>
  new Intl.DateTimeFormat('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${month}-15T12:00:00Z`))

/** The last 12 months up to and including `month`, oldest first. */
export function lastMonths(month: string, n = 12) {
  const [y, m] = month.split('-').map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 15))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/* --------------------------------------------------------- closed books -- */

export async function closedThrough(): Promise<string> {
  const { books_closed_through } = await getSettings(['books_closed_through'])
  return isMonth(books_closed_through) ? books_closed_through : ''
}

/** Refuse to add or change anything dated in a month closed for the accountant. */
export async function assertOpen(day: string) {
  const closed = await closedThrough()
  if (closed && monthOf(day) <= closed) {
    throw new FinanceError(`${monthName(monthOf(day))} is closed for the accountant. Reopen it in Reports to change it.`)
  }
}

/* ------------------------------------------------------------- numbers -- */

const NUMBER_LOCK = 7_311_002

/** P-2026-0001, WS-2026-0001: per prefix and year, without gaps. */
export async function nextNumber(tx: Tx, table: 'purchases' | 'wholesale_sales', prefix: string, day: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(${NUMBER_LOCK})`)
  const start = `${prefix}-${day.slice(0, 4)}-`
  /* The highest so far, not a count: a deleted draft must never free a number twice. */
  const r = await tx.execute(
    sql`select coalesce(max(substring(number from ${start.length + 1}::int)::int), 0) as n from ${sql.identifier(table)} where number like ${start + '%'}`,
  )
  const n = Number((r.rows[0] as { n: number } | undefined)?.n ?? 0)
  return `${start}${String(n + 1).padStart(4, '0')}`
}

/* --------------------------------------------------------- attachments -- */

export const ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024
export type OwnerType = 'purchase' | 'expense' | 'wholesale' | 'movement'

function sniff(b: Buffer, type: string) {
  if (type === 'application/pdf') return b.subarray(0, 5).toString('latin1') === '%PDF-'
  if (type === 'image/jpeg') return b[0] === 0xff && b[1] === 0xd8
  if (type === 'image/png') return b.readUInt32BE(0) === 0x89504e47
  if (type === 'image/webp') return b.subarray(8, 12).toString('latin1') === 'WEBP'
  return false
}

export async function addAttachment(owner: { type: OwnerType; id: string }, file: { bytes: Buffer; contentType: string; filename: string }, by: string | null) {
  if (!ATTACHMENT_TYPES.includes(file.contentType)) throw new FinanceError('Attach a photo (JPG, PNG, WebP) or a PDF.')
  if (file.bytes.length === 0) throw new FinanceError('That file is empty.')
  if (file.bytes.length > MAX_ATTACHMENT_BYTES) throw new FinanceError('That file is over 8 MB.')
  if (!sniff(file.bytes, file.contentType)) throw new FinanceError('That file does not look like a photo or a PDF.')
  return db.transaction(async (tx) => {
    const [m] = await tx
      .insert(media)
      .values({ contentType: file.contentType, bytes: file.bytes, size: file.bytes.length, filename: file.filename.slice(0, 200) })
      .returning({ id: media.id })
    const [a] = await tx
      .insert(attachments)
      .values({
        ownerType: owner.type,
        ownerId: owner.id,
        mediaId: m.id,
        filename: file.filename.slice(0, 200) || 'file',
        contentType: file.contentType,
        size: file.bytes.length,
        createdBy: by,
      })
      .returning()
    return a
  })
}

export async function attachmentsOf(type: OwnerType, ids: string[]) {
  if (ids.length === 0) return []
  return db
    .select()
    .from(attachments)
    .where(and(eq(attachments.ownerType, type), inArray(attachments.ownerId, ids)))
    .orderBy(asc(attachments.createdAt))
}

export async function deleteAttachment(id: string) {
  const [a] = await db.select().from(attachments).where(eq(attachments.id, id))
  if (!a) return null
  await db.delete(media).where(eq(media.id, a.mediaId))
  return a
}

/** The bytes, for the accountant's pack. */
export async function attachmentBytes(mediaIds: string[]) {
  if (mediaIds.length === 0) return new Map<string, Buffer>()
  const rows = await db.select({ id: media.id, bytes: media.bytes }).from(media).where(inArray(media.id, mediaIds))
  return new Map(rows.map((r) => [r.id, r.bytes]))
}

/** Read the files of a multipart upload (field "file"). */
export async function filesFrom(request: Request): Promise<{ bytes: Buffer; contentType: string; filename: string }[]> {
  const form = await request.formData()
  const files = form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f)
  return Promise.all(
    files.slice(0, 10).map(async (f) => ({
      bytes: Buffer.from(await f.arrayBuffer()),
      contentType: f.type || 'application/octet-stream',
      filename: f.name || 'file',
    })),
  )
}
