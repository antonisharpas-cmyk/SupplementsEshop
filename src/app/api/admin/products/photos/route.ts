/* Photos named by barcode (EAN) or SKU.
   POST { names }       which flavour each file goes to, nothing saved
   PUT  multipart file  add one photo to the product of its flavour */
import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AdminError, requireAdminApi } from '@/lib/admin'
import { fail, json, readJson } from '@/lib/api'
import { addProductPhoto, replaceProductPhoto } from '@/lib/admin-products'
import { matchPhotos } from '@/lib/product-import'

const schema = z.object({ names: z.array(z.string().max(300)).min(1).max(500) })

export async function POST(request: Request) {
  const g = await requireAdminApi()
  if ('response' in g) return g.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  return json({ ok: true, matches: await matchPhotos(body.data.names) })
}

export async function PUT(request: Request) {
  const g = await requireAdminApi()
  if ('response' in g) return g.response
  try {
    const form = await request.formData()
    const f = form.get('file')
    const name = String(form.get('name') ?? '')
    if (!f || typeof f !== 'object' || !('arrayBuffer' in f)) return fail(422, 'INVALID_INPUT', 'No photo.')
    const [m] = await matchPhotos([name || (f as File).name])
    if (!m.productId || !m.variantId) return fail(422, 'INVALID_INPUT', `No product has the code ${m.code}.`)
    const file = f as File
    const bytes = Buffer.from(await file.arrayBuffer())
    /* Same file name as a photo already there: replace it in place. */
    const replaced = m.replaces ? await replaceProductPhoto(m.productId, { bytes, contentType: file.type, filename: name || file.name }) : null
    if (replaced) {
      revalidatePath('/[locale]', 'layout')
      return json({ ok: true, id: replaced.id, label: m.label, replaced: true })
    }
    const image = await addProductPhoto(
      m.productId,
      { bytes, contentType: file.type, filename: name || file.name },
      m.label ? { en: m.label } : undefined,
      m.variantId,
    )
    revalidatePath('/[locale]', 'layout')
    return json({ ok: true, id: image.id, label: m.label })
  } catch (err) {
    if (err instanceof AdminError) return fail(422, 'INVALID_INPUT', err.message)
    console.error('[products/photos]', err)
    return fail(500, 'FAILED', 'That photo could not be saved.')
  }
}
