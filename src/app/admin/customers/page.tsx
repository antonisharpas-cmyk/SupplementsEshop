/* Members: everyone with an account, newest first, with what they have
   ordered and spent. */

import Link from 'next/link'
import { guardAdmin } from '@/lib/admin'
import { listCustomers } from '@/lib/orders'
import { formatMoney } from '@/lib/pricing'
import { Empty, PageHead, Pagination, Pill, Table, input, withParams } from '@/components/admin/ui'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Customers' }

type SP = Record<string, string | string[] | undefined>
const day = (d: Date | null) => (d ? new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Europe/Nicosia' }).format(d) : '—')

export default async function AdminCustomersPage({ searchParams }: { searchParams: Promise<SP> }) {
  await guardAdmin('/admin/customers')
  const sp = await searchParams
  const q = typeof sp.q === 'string' ? sp.q : ''
  const list = await listCustomers({ q, page: Number(sp.page) || 1 })
  return (
    <>
      <PageHead title="Customers" sub={`${list.total} member${list.total === 1 ? '' : 's'}`} />
      <form className="mb-5" action="/admin/customers">
        <input name="q" defaultValue={q} placeholder="Search name, email or phone" className={`${input} max-w-xl`} />
      </form>
      {list.rows.length === 0 ? (
        <Empty>No customers{q ? ` matching “${q}”` : ' yet'}.</Empty>
      ) : (
        <Table head={['Name', 'Email', 'Phone', 'Joined', 'Last sign in', 'Orders', 'Spent', '']}>
          {list.rows.map((c) => (
            <tr key={c.id} className="hover:bg-paper-2">
              <td className="px-4 py-3">
                <Link href={`/admin/customers/${c.id}`} className="text-heading underline-offset-4 hover:underline">
                  {c.firstName} {c.lastName}
                </Link>
              </td>
              <td className="px-4 py-3">{c.email}</td>
              <td className="px-4 py-3 whitespace-nowrap">{c.phone}</td>
              <td className="px-4 py-3 whitespace-nowrap text-muted">{day(c.createdAt)}</td>
              <td className="px-4 py-3 whitespace-nowrap text-muted">{day(c.lastLoginAt)}</td>
              <td className="px-4 py-3 tabular-nums">{c.orders}</td>
              <td className="px-4 py-3 tabular-nums">{formatMoney(c.spentCents)}</td>
              <td className="px-4 py-3">{!c.isActive && <Pill tone="off">Off</Pill>}</td>
            </tr>
          ))}
        </Table>
      )}
      <Pagination page={list.page} pages={list.pages} total={list.total} noun={['customer', 'customers']} href={(p) => withParams('/admin/customers', sp, { page: p })} />
    </>
  )
}
