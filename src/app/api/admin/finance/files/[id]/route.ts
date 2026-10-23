/* GET: open a kept file. DELETE: remove it. */
import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { attachments, media } from '@/db/schema'
import { canSeeFinance, requireAdminApi } from '@/lib/admin'
import { fail, UUID } from '@/lib/api'
import { deleteAttachment } from '@/lib/finance'
import { run } from '../../_shared'

async function allowed(id: string) {
  const g = await requireAdminApi()
  if ('response' in g) return { response: g.response }
  const [a] = await db.select().from(attachments).where(eq(attachments.id, id))
  if (!a) return { response: fail(404, 'NOT_FOUND') }
  if (a.ownerType !== 'movement' && !canSeeFinance(g.user)) return { response: fail(404, 'NOT_FOUND') }
  return { a, user: g.user }
}

export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const r = await allowed(id)
  if ('response' in r) return r.response
  const [m] = await db.select({ bytes: media.bytes }).from(media).where(eq(media.id, r.a.mediaId))
  if (!m) return fail(404, 'NOT_FOUND')
  return new Response(new Uint8Array(m.bytes), {
    headers: {
      'Content-Type': r.a.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(r.a.filename)}`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

export async function DELETE(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  if (!UUID.test(id)) return fail(404, 'NOT_FOUND')
  const r = await allowed(id)
  if ('response' in r) return r.response
  return run(async () => {
    await deleteAttachment(id)
  })
}
