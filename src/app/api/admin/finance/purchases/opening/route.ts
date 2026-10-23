/* GET: the opening stock template (every product, its stock and cost now).
   POST file: check the filled template (?apply=1 to apply it). */
import { requireFinanceApi } from '@/lib/admin'
import { fail, json } from '@/lib/api'
import { applyOpening, readOpening } from '@/lib/purchases'
import { readTable } from '@/lib/sheet-read'
import { stockWithCosts, variantLabel } from '@/lib/stock'
import { toXlsx } from '@/lib/spreadsheet'
import { audit } from '@/lib/audit'

export async function GET() {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const rows = await stockWithCosts()
  const file = toXlsx([
    {
      name: 'Opening stock',
      columns: [
        { header: 'SKU', width: 18 },
        { header: 'Product', width: 40 },
        { header: 'Size', width: 10 },
        { header: 'Counted quantity', kind: 'int', width: 16 },
        { header: 'Unit cost', kind: 'money', width: 14 },
        { header: 'Status', width: 22 },
        { header: 'Category', width: 22 },
      ],
      /* Every product, including those with nothing on the shelf. Status and
         Category are for reading only; the upload uses SKU, quantity and cost. */
      rows: rows.map((r) => [
        r.sku,
        variantLabel(r),
        r.size,
        r.onHand,
        r.avgCostCents ? Math.round(r.avgCostCents) / 100 : null,
        !r.isActive ? 'Hidden' : !r.variantActive ? 'Flavour switched off' : r.availability !== 'AVAILABLE' || r.onHand - r.reserved <= 0 ? 'Sold out' : 'On sale',
        r.categoryName ?? '',
      ]),
    },
  ])
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="opening-stock.xlsx"',
      'Cache-Control': 'no-store',
    },
  })
}

export async function POST(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const apply = new URL(request.url).searchParams.get('apply') === '1'
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) return fail(422, 'INVALID_INPUT', 'Choose the filled file.')
    const rows = await readOpening(readTable(Buffer.from(await f.arrayBuffer())).slice(0, 5000))
    if (!apply) return json({ ok: true, rows })
    const result = await applyOpening(rows, g.user.id)
    await audit({ actor: g.user, action: 'stock.opening', entity: 'stock', diff: result })
    return json({ ok: true, ...result })
  } catch (err) {
    console.error('[purchases/opening]', err)
    return fail(422, 'INVALID_INPUT', err instanceof Error && err.message.startsWith('Only') ? err.message : 'That file could not be read. Use the template, saved as .xlsx or .csv.')
  }
}
