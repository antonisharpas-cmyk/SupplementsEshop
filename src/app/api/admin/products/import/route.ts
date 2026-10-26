/* GET: the empty products sheet (with the list of categories).
   POST file: check the filled sheet (?apply=1 to create the products). */
import { revalidatePath } from 'next/cache'
import { requireAdminApi } from '@/lib/admin'
import { fail, json } from '@/lib/api'
import { applyImport, checkImport, templateFile } from '@/lib/product-import'
import { readTable } from '@/lib/sheet-read'
import { audit } from '@/lib/audit'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export async function GET() {
  const g = await requireAdminApi()
  if ('response' in g) return g.response
  return new Response(new Uint8Array(await templateFile()), {
    headers: { 'Content-Type': XLSX, 'Content-Disposition': 'attachment; filename="new-products.xlsx"', 'Cache-Control': 'no-store' },
  })
}

export async function POST(request: Request) {
  const g = await requireAdminApi()
  if ('response' in g) return g.response
  const apply = new URL(request.url).searchParams.get('apply') === '1'
  let rows
  try {
    const form = await request.formData()
    const f = form.get('file')
    if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) return fail(422, 'INVALID_INPUT', 'Choose the filled sheet.')
    rows = await checkImport(readTable(Buffer.from(await f.arrayBuffer())).slice(0, 2000))
  } catch (err) {
    console.error('[products/import]', err)
    return fail(422, 'INVALID_INPUT', 'That file could not be read. Use the sheet from this page, saved as .xlsx or .csv.')
  }
  if (!apply) return json({ ok: true, rows })
  try {
    const result = await applyImport(rows)
    await audit({ actor: g.user, action: 'product.import', entity: 'product', diff: result })
    revalidatePath('/admin/products')
    return json({ ok: true, ...result })
  } catch (err) {
    console.error('[products/import] apply', err)
    return fail(500, 'FAILED', 'Something went wrong part way. Check the sheet again: what was created shows as already there.')
  }
}
