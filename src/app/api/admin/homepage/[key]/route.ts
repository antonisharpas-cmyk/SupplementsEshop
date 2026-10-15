/* ============================================================================
 * Admin: the hand-picked contents of one homepage section.
 *
 *   PUT { ids: [uuid, …] }   — the complete list, in display order
 *
 * Products for Moving fast / New in / On sale, subcategories for Shop by
 * category. Every id is checked against the database before anything is
 * written; the old list is replaced in one transaction, so a failed save
 * leaves the section exactly as it was.
 * ========================================================================== */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { HomepageError, SECTION_KEYS, saveSectionItems, type SectionKey } from '@/lib/homepage'

const bodySchema = z.object({
  ids: z.array(z.string().uuid()).max(50),
})

export async function PUT(request: Request, context: { params: Promise<{ key: string }> }) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response

  const { key } = await context.params
  if (!SECTION_KEYS.includes(key as SectionKey)) {
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
      { ok: false, error: 'INVALID_INPUT', message: 'That list was not valid.' },
      { status: 422 },
    )
  }

  try {
    await saveSectionItems(key as SectionKey, parsed.data.ids)
  } catch (err) {
    if (err instanceof HomepageError) {
      return Response.json({ ok: false, error: 'INVALID_INPUT', message: err.message }, { status: 422 })
    }
    console.error('[api/admin/homepage/key] failed', err)
    return Response.json({ ok: false, error: 'SAVE_FAILED' }, { status: 500 })
  }

  revalidatePath('/[locale]', 'page')
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
