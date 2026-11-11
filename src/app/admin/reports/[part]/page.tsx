/* One finance report: /admin/reports/profit, /margins, /vat, /spending,
   /stock-value or /accountant. */

import { notFound } from 'next/navigation'
import { FinanceReports, type FinancePart, type SP } from '@/components/admin/reports/FinanceReports'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Reports' }

const PARTS: FinancePart[] = ['profit', 'margins', 'vat', 'spending', 'stock-value', 'accountant']

export default async function FinanceReportPage({ params, searchParams }: { params: Promise<{ part: string }>; searchParams: Promise<SP> }) {
  const { part } = await params
  if (!(PARTS as string[]).includes(part)) notFound()
  return <FinanceReports sp={await searchParams} part={part as FinancePart} />
}
