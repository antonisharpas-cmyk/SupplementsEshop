/* ============================================================================
 * Admin: download invoices for the accountant.
 *
 *   ?format=xlsx   Excel workbook: Invoices, Lines and Monthly summary sheets
 *   ?format=csv    one CSV (?sheet=invoices, the default, or ?sheet=lines)
 *
 * Takes the same filters as the accounting page: from, to, kind, method, q.
 * ========================================================================== */

import { requireAdminApi } from '@/lib/admin'
import { accountingSheets, filterFrom } from '@/lib/accounting-export'
import { ensureInvoices } from '@/lib/invoices'
import { toCsv, toXlsx } from '@/lib/spreadsheet'
import { audit } from '@/lib/audit'

export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response

  const url = new URL(request.url)
  const get = (k: string) => url.searchParams.get(k) ?? undefined
  const filter = filterFrom(get)
  const format = get('format') === 'csv' ? 'csv' : 'xlsx'

  await ensureInvoices()
  const sheets = await accountingSheets(filter)
  const period = [filter.from, filter.to].filter(Boolean).join('_to_') || 'all'
  const base = `aionix-invoices-${period}`

  await audit({
    actor: { id: guard.user.id, email: guard.user.email },
    action: 'accounting.export',
    entity: 'invoices',
    diff: { format, ...filter, rows: sheets.invoices.rows.length },
  })

  if (format === 'csv') {
    const which = get('sheet') === 'lines' ? sheets.lines : sheets.invoices
    const name = get('sheet') === 'lines' ? `${base}-lines.csv` : `${base}.csv`
    return new Response(toCsv(which), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${name}"`,
        'Cache-Control': 'no-store',
      },
    })
  }

  const file = toXlsx([sheets.invoices, sheets.lines, sheets.summary])
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${base}.xlsx"`,
      'Cache-Control': 'no-store',
    },
  })
}
