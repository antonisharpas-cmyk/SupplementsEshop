/* POST ?type=purchase|expense|wholesale|movement&id=: attach files (field
   "file", photos are shrunk in the browser first). Photos of stock written
   off can be added by any staff; everything else needs the owner or a manager. */
import { requireAdminApi, requireFinanceApi } from '@/lib/admin'
import { fail, UUID } from '@/lib/api'
import { addAttachment, filesFrom, type OwnerType } from '@/lib/finance'
import { run } from '../_shared'

const TYPES: OwnerType[] = ['purchase', 'expense', 'wholesale', 'movement']

export async function POST(request: Request) {
  const url = new URL(request.url)
  const type = url.searchParams.get('type') as OwnerType
  const id = url.searchParams.get('id') ?? ''
  if (!TYPES.includes(type) || !UUID.test(id)) return fail(404, 'NOT_FOUND')
  const g = type === 'movement' ? await requireAdminApi() : await requireFinanceApi()
  if ('response' in g) return g.response
  let files
  try {
    files = await filesFrom(request)
  } catch {
    return fail(422, 'INVALID_INPUT', 'Choose a file.')
  }
  if (files.length === 0) return fail(422, 'INVALID_INPUT', 'Choose a file.')
  return run(async () => {
    const saved = []
    for (const f of files) saved.push(await addAttachment({ type, id }, f, g.user.id))
    return { files: saved.map((a) => ({ id: a.id, filename: a.filename })) }
  })
}
