/* Serves a photo uploaded in the admin panel. The id is random and the bytes
   never change for an id (a replaced photo gets a new id), so it is cached
   for a year by browsers and any CDN in front of the shop. */

import { eq } from 'drizzle-orm'
import { db } from '@/db'
import { media } from '@/db/schema'
import { UUID } from '@/lib/api'

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params
  if (!UUID.test(id)) return new Response('Not found', { status: 404 })
  const [row] = await db
    .select({ bytes: media.bytes, contentType: media.contentType })
    .from(media)
    .where(eq(media.id, id))
    .limit(1)
  if (!row) return new Response('Not found', { status: 404 })
  return new Response(new Uint8Array(row.bytes), {
    headers: {
      'Content-Type': row.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
