/* GET ?month=YYYY-MM: the accountant's ZIP for that month. */
import { requireFinanceApi } from '@/lib/admin'
import { fail } from '@/lib/api'
import { buildPack } from '@/lib/finance-pack'
import { isMonth } from '@/lib/finance'
import { audit } from '@/lib/audit'

export async function GET(request: Request) {
  const g = await requireFinanceApi()
  if ('response' in g) return g.response
  const month = new URL(request.url).searchParams.get('month') ?? ''
  if (!isMonth(month)) return fail(422, 'INVALID_INPUT', 'Choose a month.')
  const pack = await buildPack(month)
  await audit({ actor: g.user, action: 'books.pack', entity: 'settings', entityId: month })
  return new Response(new Uint8Array(pack.bytes), {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${pack.filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
