/* ============================================================================
 * One invoice or credit note, laid out as the printed document. "Print or
 * save as PDF" uses the browser's own print, with the admin menu hidden.
 * ========================================================================== */

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { guardAdmin } from '@/lib/admin'
import { getInvoice } from '@/lib/invoices'
import { formatMoney } from '@/lib/pricing'
import { UUID } from '@/lib/api'
import { btn } from '@/components/admin/ui'
import { PrintButton } from '@/components/admin/PrintButton'

export const dynamic = 'force-dynamic'

const when = (d: Date) =>
  new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Europe/Nicosia' }).format(d)

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const found = UUID.test(id) ? await getInvoice(id) : null
  return { title: found ? found.invoice.number : 'Invoice' }
}

export default async function InvoicePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await guardAdmin(`/admin/accounting/${id}`)
  if (!UUID.test(id)) notFound()
  const found = await getInvoice(id)
  if (!found) notFound()
  const { invoice: inv, related } = found
  const credit = inv.kind === 'CREDIT_NOTE'
  const money = (c: number) => formatMoney(c, 'en', inv.currency)
  const sign = credit ? -1 : 1
  const original = credit ? related.find((r) => r.id === inv.relatesToId) : null
  const wholesale = Boolean(inv.wholesaleSaleId)

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href="/admin/accounting" className={btn.quiet}>
          ← Accounting
        </Link>
        <div className="flex flex-wrap gap-2">
          <Link href={inv.orderId ? `/admin/orders/${inv.orderId}` : `/admin/wholesale/${inv.wholesaleSaleId}`} className={btn.secondary}>
            {inv.orderId ? 'Order' : 'Wholesale sale'} {inv.orderNumber}
          </Link>
          <PrintButton className={btn.primary}>Print or save as PDF</PrintButton>
        </div>
      </div>

      {related.length > 0 && (
        <p className="mb-5 text-sm text-muted print:hidden">
          Also on this order:{' '}
          {related.map((r, n) => (
            <span key={r.id}>
              {n > 0 && ', '}
              <Link href={`/admin/accounting/${r.id}`} className="font-mono text-ink underline underline-offset-4 hover:text-accent">
                {r.number}
              </Link>
            </span>
          ))}
        </p>
      )}

      <article className="invoice-sheet mx-auto max-w-[52rem] rounded-2xl bg-white p-8 text-[#111] shadow-[0_30px_80px_-40px_rgba(0,0,0,.8)] sm:p-12 print:max-w-none print:rounded-none print:p-0 print:shadow-none">
        <header className="flex flex-wrap items-start justify-between gap-8 border-b-2 border-[#111] pb-6">
          <div>
            <p className="font-display text-3xl font-bold tracking-tight text-[#111]">{inv.seller.name}</p>
            <div className="mt-2 space-y-0.5 text-sm text-[#555]">
              {inv.seller.address?.map((l) => <p key={l}>{l}</p>)}
              {inv.seller.vatNumber && <p>VAT {inv.seller.vatNumber}</p>}
              {inv.seller.taxId && <p>TIC {inv.seller.taxId}</p>}
              {inv.seller.email && <p>{inv.seller.email}</p>}
              {inv.seller.phone && <p>{inv.seller.phone}</p>}
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#777] uppercase">{credit ? 'Credit note' : wholesale ? 'Invoice' : 'Invoice / Receipt'}</p>
            <p className="mt-1 font-mono text-xl font-semibold text-[#111]">{inv.number}</p>
            <dl className="mt-3 space-y-0.5 text-sm text-[#555]">
              <div>
                <dt className="inline">Date: </dt>
                <dd className="inline text-[#111]">{when(inv.issuedAt)}</dd>
              </div>
              <div>
                <dt className="inline">{wholesale ? 'Sale' : 'Order'}: </dt>
                <dd className="inline font-mono text-[#111]">{inv.orderNumber}</dd>
              </div>
              {wholesale ? (
                !credit && (
                  <div>
                    <dt className="inline">Payment: </dt>
                    <dd className="inline text-[#111]">{inv.dueAt ? `due by ${when(inv.dueAt)}` : 'on delivery'}</dd>
                  </div>
                )
              ) : (
                <div>
                  <dt className="inline">{credit ? 'Refunded by: ' : 'Paid upon issuance with: '}</dt>
                  <dd className="inline text-[#111]">{inv.paymentMethod === 'cod' ? 'Cash' : 'Card'}</dd>
                </div>
              )}
              {original && (
                <div>
                  <dt className="inline">Credits invoice: </dt>
                  <dd className="inline font-mono text-[#111]">{original.number}</dd>
                </div>
              )}
            </dl>
          </div>
        </header>

        <section className="mt-6">
          <p className="text-xs font-semibold tracking-[0.14em] text-[#777] uppercase">Bill to</p>
          <div className="mt-2 text-sm leading-relaxed">
            <p className="font-semibold text-[#111]">{inv.customer.name}</p>
            {inv.customer.address?.map((l) => (
              <p key={l} className="text-[#555]">
                {l}
              </p>
            ))}
            {inv.customer.vatNumber && <p className="text-[#555]">VAT {inv.customer.vatNumber}</p>}
            {inv.customer.taxId && <p className="text-[#555]">TIC {inv.customer.taxId}</p>}
            {inv.customer.email && <p className="text-[#555]">{inv.customer.email}</p>}
            {inv.customer.phone && <p className="text-[#555]">{inv.customer.phone}</p>}
          </div>
        </section>

        <div className="mt-8 overflow-x-auto print:overflow-visible">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#ddd] text-left text-xs tracking-[0.1em] text-[#777] uppercase">
                <th className="py-2 pr-3 font-semibold">Description</th>
                <th className="py-2 px-3 text-right font-semibold">Qty</th>
                <th className="py-2 px-3 text-right font-semibold">{inv.linesNet ? 'Unit before VAT' : 'Unit'}</th>
                <th className="py-2 pl-3 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {inv.lines.map((l, n) => (
                <tr key={n} className="border-b border-[#eee] align-top">
                  <td className="py-3 pr-3">
                    <p className="text-[#111]">{l.description}</p>
                    {l.sku && <p className="font-mono text-[11px] text-[#888]">{l.sku}</p>}
                  </td>
                  <td className="py-3 px-3 text-right tabular-nums">{l.quantity}</td>
                  <td className="py-3 px-3 text-right tabular-nums">{money(l.unitCents)}</td>
                  <td className="py-3 pl-3 text-right tabular-nums">{money(l.totalCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-6 ml-auto max-w-xs space-y-1.5 text-sm">
          <div className="flex justify-between text-[#555]">
            <span>Net</span>
            <span className="tabular-nums">{money(sign * inv.netCents)}</span>
          </div>
          <div className="flex justify-between text-[#555]">
            <span>VAT {(inv.vatRateBp / 100).toLocaleString('en-GB', { maximumFractionDigits: 2 })}%</span>
            <span className="tabular-nums">{money(sign * inv.vatCents)}</span>
          </div>
          <div className="flex justify-between border-t-2 border-[#111] pt-2 text-base font-bold text-[#111]">
            <span>{credit ? 'Total credited' : wholesale ? 'Total' : 'Total paid'}</span>
            <span className="tabular-nums">{money(sign * inv.totalCents)}</span>
          </div>
          <p className="pt-1 text-right text-xs text-[#888]">{inv.linesNet ? 'Prices before VAT' : 'Prices include VAT'}</p>
          {!wholesale && (
            <p className="pt-3 text-right text-xs font-semibold text-[#111]">
              {credit
                ? `Refund recorded on ${when(inv.issuedAt)}${original ? `, against invoice ${original.number}` : ''}.`
                : `Paid in full on ${when(inv.issuedAt)}. This document is your VAT invoice and your receipt.`}
            </p>
          )}
          {wholesale && credit && original && <p className="pt-3 text-right text-xs font-semibold text-[#111]">Against invoice {original.number}.</p>}
        </div>

        {inv.note && <p className="mt-10 whitespace-pre-line border-t border-[#eee] pt-5 text-center text-sm text-[#555]">{inv.note}</p>}
      </article>
    </>
  )
}
