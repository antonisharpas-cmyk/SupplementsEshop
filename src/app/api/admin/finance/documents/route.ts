/* GET ?from=YYYY-MM-DD&to=YYYY-MM-DD&kinds=online,wholesale,purchases,expenses,stock:
   every invoice, credit note, supplier invoice and receipt of the period in one ZIP. */
import { requireFinanceApi } from '@/lib/admin'
import { fail } from '@/lib/api'
import { buildDocuments, DOCUMENT_KINDS, type DocumentKind } from '@/lib/finance-documents'
import { FinanceError, isDay } from '@/lib/finance'
import { audit } from '@/lib/audit'

export async function GET(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const q = new URL(request.url).searchParams
  const from = q.get('from') ?? ''
  const to = q.get('to') ?? ''
  if (!isDay(from) || !isDay(to)) return fail(422, 'INVALID_INPUT', 'Choose the dates.')
  const kinds = (q.get('kinds') ?? Object.keys(DOCUMENT_KINDS).join(',')).split(',').filter((k): k is DocumentKind => k in DOCUMENT_KINDS)
  if (kinds.length === 0) return fail(422, 'INVALID_INPUT', 'Choose what to download.')
  try {
    const out = await buildDocuments({ from, to, kinds })
    await audit({ actor: g.user, action: 'books.documents', entity: 'settings', entityId: `${from}..${to}`, diff: { kinds, count: out.count } })
    return new Response(new Uint8Array(out.bytes), {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="${out.filename}"`, 'Cache-Control': 'no-store' },
    })
  } catch (err) {
    if (err instanceof FinanceError) return fail(422, 'REFUSED', err.message)
    console.error('[finance/documents]', err)
    return fail(500, 'FAILED', 'The documents could not be put together. Please try again.')
  }
}
