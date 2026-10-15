/* ============================================================================
 * Admin: the order, visibility and mode of the homepage sections.
 *
 *   PUT { sections: [{ key, isVisible, mode }, …] }   — every section, in order
 *
 * The whole arrangement is sent every time, never a single move: "put this
 * section at position 2" from two open tabs would interleave into an order
 * nobody chose, where two complete lists simply leave the later one.
 * ========================================================================== */

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { HomepageError, LAYOUT_KEYS, saveLayout } from '@/lib/homepage'

const bodySchema = z.object({
  sections: z
    .array(
      z.object({
        key: z.enum(LAYOUT_KEYS as [string, ...string[]]),
        isVisible: z.boolean(),
        mode: z.enum(['auto', 'manual']),
      }),
    )
    /* All of them — or all but the sign-up, from older screens. */
    .min(LAYOUT_KEYS.length - 1)
    .max(LAYOUT_KEYS.length),
})

export async function PUT(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: 'INVALID_INPUT', message: 'That layout was not valid.' },
      { status: 422 },
    )
  }

  try {
    await saveLayout(parsed.data.sections as Parameters<typeof saveLayout>[0])
  } catch (err) {
    if (err instanceof HomepageError) {
      return Response.json({ ok: false, error: 'INVALID_INPUT', message: err.message }, { status: 422 })
    }
    console.error('[api/admin/homepage] failed', err)
    return Response.json({ ok: false, error: 'SAVE_FAILED' }, { status: 500 })
  }

  /* Every language's homepage, rebuilt on its next visit. */
  revalidatePath('/[locale]', 'page')
  return Response.json({ ok: true }, { headers: { 'Cache-Control': 'no-store' } })
}
