/* GET: "Where the stock went" as an Excel file, for the dates chosen. */

import { requireAdminApi } from '@/lib/admin'
import { TRACE_COLUMNS, traceAll } from '@/lib/stock-trace'
import { toXlsx } from '@/lib/spreadsheet'

export async function GET(request: Request) {
  const guard = await requireAdminApi()
  if ('response' in guard) return guard.response
  const url = new URL(request.url)
  const from = url.searchParams.get('from')
  const to = url.searchParams.get('to')
  const rows = await traceAll({ from, to }, { q: url.searchParams.get('q') ?? undefined })
  const allTime = !from && !to
  const file = toXlsx([
    {
      name: 'Where the stock went',
      columns: [
        { header: 'Product', kind: 'text' },
        { header: 'Flavour', kind: 'text' },
        { header: 'Size', kind: 'text' },
        { header: 'SKU', kind: 'text' },
        ...TRACE_COLUMNS.map((c) => ({ header: c.label, kind: 'int' as const })),
        ...(allTime ? [{ header: 'Not explained', kind: 'int' as const }] : []),
        { header: 'On shelf now', kind: 'int' },
      ],
      rows: rows.map((r) => [
        r.product.en ?? Object.values(r.product)[0] ?? '',
        r.flavour?.en ?? '',
        r.size,
        r.sku,
        ...TRACE_COLUMNS.map((c) => r.values[c.key]),
        ...(allTime ? [r.unexplained ?? 0] : []),
        r.onShelf,
      ]),
    },
  ])
  const name = `stock-trace${from ? `-${from}` : ''}${to ? `-to-${to}` : ''}.xlsx`
  return new Response(new Uint8Array(file), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${name}"`,
      'Cache-Control': 'no-store',
    },
  })
}
