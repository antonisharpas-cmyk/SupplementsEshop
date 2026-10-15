/* Admin: the company details printed on invoices. */

import { z } from 'zod'
import { requireAdminApi } from '@/lib/admin'
import { setSetting } from '@/lib/settings'
import { json, readJson } from '@/lib/api'
import { audit } from '@/lib/audit'

const schema = z.object({
  company_legal_name: z.string().trim().max(160),
  company_vat_number: z.string().trim().max(40),
  company_tax_id: z.string().trim().max(40),
  company_address: z.string().trim().max(500),
  invoice_footer: z.string().trim().max(500),
})

export async function PUT(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const body = await readJson(request, schema)
  if ('response' in body) return body.response
  for (const [k, v] of Object.entries(body.data) as [keyof typeof body.data, string][]) {
    await setSetting(k, v, guard.user.id)
  }
  await audit({ actor: { id: guard.user.id, email: guard.user.email }, action: 'accounting.company', entity: 'settings', diff: body.data })
  return json({ ok: true })
}
