/* POST { text }: the supplier's invoice lines, pasted as text, turned into
   the products sheet (name, flavour, size, EAN, cost and quantity filled
   in; category and selling price left for the owner). */
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { fail, readJson } from '@/lib/api'
import { invoiceSheet, readInvoiceText } from '@/lib/product-import'

const schema = z.object({ text: z.string().min(1).max(200_000) })

export async function POST(request: Request) {
  const g = await requireAdminApi()
  if ('response' in g) return g.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  const lines = readInvoiceText(body.data.text)
  if (lines.length === 0) return fail(422, 'INVALID_INPUT', 'No lines with a barcode (EAN) were found in that text.')
  const file = await invoiceSheet(lines)
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="products-from-invoice.xlsx"',
      'Cache-Control': 'no-store',
      'X-Lines': String(lines.length),
    },
  })
}
