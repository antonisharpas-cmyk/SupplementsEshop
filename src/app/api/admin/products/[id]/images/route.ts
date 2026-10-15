/* ============================================================================
 * Admin: the order of one product's photos.
 *
 *   PUT  { ids: [uuid, …] }   every photo of this product, first one first
 *   POST multipart "file"     upload one or more photos (field "file", repeatable)
 *
 * The first photo is the one on every product card and at the top of the
 * product page; the second is the one a card fades to on hover.
 * ========================================================================== */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { AdminError, reorderProductImages, requireAdminApi } from '@/lib/admin'
import { addProductPhoto } from '@/lib/admin-products'
import { audit } from '@/lib/audit'

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(40),
})

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response

  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'INVALID_INPUT', message: 'That photo order was not valid.' },
      { status: 422 },
    )
  }

  try {
    await reorderProductImages(id, parsed.data.ids)
  } catch (err) {
    if (err instanceof AdminError) {
      return Response.json({ ok: false, error: 'INVALID_INPUT', message: err.message }, { status: 422 })
    }
    console.error('[api/admin/products/images] failed', err)
    return Response.json({ ok: false, error: 'SAVE_FAILED' }, { status: 500 })
  }

  /* Cards appear on every listing, so everything under the storefront. */
  revalidatePath('/[locale]', 'layout')
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const { id } = await context.params
  if (!z.string().uuid().safeParse(id).success) {
    return Response.json({ ok: false, error: 'NOT_FOUND' }, { status: 404 })
  }

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return Response.json({ ok: false, error: 'INVALID_INPUT', message: 'Choose a photo to upload.' }, { status: 422 })
  }
  const files = form.getAll('file').filter((f): f is File => typeof f === 'object' && f !== null && 'arrayBuffer' in f)
  if (files.length === 0) {
    return Response.json({ ok: false, error: 'INVALID_INPUT', message: 'Choose a photo to upload.' }, { status: 422 })
  }
  if (files.length > 12) {
    return Response.json({ ok: false, error: 'INVALID_INPUT', message: 'Upload up to 12 photos at a time.' }, { status: 422 })
  }

  const added: { id: string; url: string }[] = []
  try {
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer())
      added.push(await addProductPhoto(id, { bytes, contentType: file.type, filename: file.name }))
    }
  } catch (err) {
    if (err instanceof AdminError) {
      return Response.json({ ok: false, error: 'INVALID_INPUT', message: err.message, added }, { status: 422 })
    }
    console.error('[api/admin/products/images] upload failed', err)
    return Response.json({ ok: false, error: 'SAVE_FAILED', message: 'Could not save that photo.', added }, { status: 500 })
  }
  await audit({ actor: guard.user, action: 'product.photo.add', entity: 'product', entityId: id, diff: { count: added.length } })
  revalidatePath('/[locale]', 'layout')
  return Response.json({ ok: true, added }, { headers: { 'Cache-Control': 'no-store' } })
}
