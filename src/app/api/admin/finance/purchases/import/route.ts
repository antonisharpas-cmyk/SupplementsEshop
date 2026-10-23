/* POST: turn a supplier's list into purchase lines. Either JSON { text }
   (rows pasted from Excel) or a file upload (field "file", .xlsx or .csv).
   GET ?supplierId=: the lines of that supplier's last purchase. */
import { requireFinanceApi } from '@/lib/admin'
import { fail, json, UUID } from '@/lib/api'
import { importLines, lastPurchaseFor } from '@/lib/purchases'
import { readDelimited, readTable } from '@/lib/sheet-read'

export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  try {
    const type = request.headers.get('content-type') ?? ''
    let rows
    if (type.includes('application/json')) {
      const body = (await request.json()) as { text?: string }
      rows = readDelimited(String(body.text ?? '').slice(0, 500_000))
    } else {
      const form = await request.formData()
      const f = form.get('file')
      if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) return fail(422, 'INVALID_INPUT', 'Choose a file.')
      if (f.size > 5_000_000) return fail(422, 'INVALID_INPUT', 'That file is over 5 MB.')
      rows = readTable(Buffer.from(await f.arrayBuffer()))
    }
    const lines = await importLines(rows.slice(0, 1000))
    return json({ ok: true, lines })
  } catch (err) {
    console.error('[purchases/import]', err)
    return fail(422, 'INVALID_INPUT', 'That file could not be read. Save it as .xlsx or .csv, or paste the rows instead.')
  }
}

export async function GET(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const supplierId = new URL(request.url).searchParams.get('supplierId') ?? ''
  if (!UUID.test(supplierId)) return fail(404, 'NOT_FOUND')
  const last = await lastPurchaseFor(supplierId)
  if (!last) return json({ ok: true, found: false })
  return json({
    ok: true,
    found: true,
    number: last.purchase.number,
    date: last.purchase.invoiceDate,
    shippingCents: last.purchase.shippingCents,
    otherFeesCents: last.purchase.otherFeesCents,
    lines: last.lines.map((l) => ({ variantId: l.variantId, description: l.description, sku: l.sku, quantity: l.quantity, freeQuantity: l.freeQuantity, unitNetCents: l.unitNetCents })),
  })
}
