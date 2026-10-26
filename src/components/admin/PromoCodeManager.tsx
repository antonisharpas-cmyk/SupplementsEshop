'use client'

/* Promo codes: the list, and the form to create or change one. */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AdminPromoCode } from '@/lib/admin-promo-codes'
import { btn, input } from '@/components/admin/ui'
import { SearchSelect } from '@/components/admin/SearchSelect'
import { DateTimeField } from '@/components/admin/DateTimeField'
import { Paged } from '@/components/admin/Paged'

type Option = { id: string; label: string }

const STATE: Record<AdminPromoCode['state'], { label: string; cls: string }> = {
  live: { label: 'Live now', cls: 'bg-ok/15 text-ok' },
  scheduled: { label: 'Scheduled', cls: 'bg-accent/15 text-accent' },
  expired: { label: 'Expired', cls: 'bg-line text-muted' },
  used_up: { label: 'Used up', cls: 'bg-line text-muted' },
  off: { label: 'Off', cls: 'bg-line text-muted' },
}

const euro = (c: number) => `€${(c / 100).toFixed(2).replace(/\.00$/, '')}`
const when = (iso: string) =>
  new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

function local(iso: string | null) {
  if (!iso) return ''
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

async function call(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  }).catch(() => null)
  const data = (await res?.json().catch(() => null)) as { ok?: boolean; message?: string } | null
  return res?.ok && data?.ok ? null : (data?.message ?? 'Something went wrong. Check the fields and try again.')
}

/** A readable random code: no 0/O or 1/I to mix up. */
function randomCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return 'AX' + Array.from({ length: 6 }, () => abc[Math.floor(Math.random() * abc.length)]).join('')
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1.5 block text-xs text-muted">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </div>
  )
}

function CodeForm({ initial, categories, onDone }: { initial?: AdminPromoCode; categories: Option[]; onDone: () => void }) {
  const router = useRouter()
  const [code, setCode] = useState(initial?.code ?? '')
  const [type, setType] = useState<'PERCENTAGE' | 'FIXED'>(initial?.discountType ?? 'PERCENTAGE')
  const [amount, setAmount] = useState(
    initial ? (initial.discountType === 'PERCENTAGE' ? String(initial.discountValue) : (initial.discountValue / 100).toFixed(2)) : '',
  )
  const [minOrder, setMinOrder] = useState(initial && initial.minOrderCents ? (initial.minOrderCents / 100).toFixed(2) : '')
  const [maxUses, setMaxUses] = useState(initial?.maxUses ? String(initial.maxUses) : '')
  const [perCustomer, setPerCustomer] = useState(initial ? (initial.maxUsesPerUser ? String(initial.maxUsesPerUser) : '') : '1')
  const [categoryId, setCategoryId] = useState(initial?.categoryId ?? '')
  const [startsAt, setStartsAt] = useState(local(initial?.startsAt ?? new Date().toISOString()))
  const [expiresAt, setExpiresAt] = useState(local(initial?.expiresAt ?? null))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const num = (s: string) => Number(s.replace(',', '.'))
  const value = type === 'PERCENTAGE' ? Math.round(num(amount)) : Math.round(num(amount) * 100)
  const whole = (s: string) => (s.trim() ? Math.max(1, Math.round(num(s))) : null)

  return (
    <form
      className="space-y-5 rounded-2xl border border-accent/40 bg-accent/5 p-5"
      onSubmit={async (e) => {
        e.preventDefault()
        if (!startsAt) return setError('Choose when it starts.')
        setBusy(true)
        setError(null)
        const body = {
          code,
          discountType: type,
          discountValue: value,
          minOrderCents: minOrder.trim() ? Math.round(num(minOrder) * 100) : 0,
          maxUses: whole(maxUses),
          maxUsesPerUser: whole(perCustomer),
          categoryId: categoryId || null,
          startsAt: new Date(startsAt).toISOString(),
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
          isActive: initial?.isActive ?? true,
        }
        const err = initial
          ? await call(`/api/admin/promo-codes/${initial.id}`, 'PATCH', { action: 'update', code: body })
          : await call('/api/admin/promo-codes', 'POST', body)
        setBusy(false)
        if (err) return setError(err)
        onDone()
        router.refresh()
      }}
    >
      <p className="font-display text-base font-semibold text-heading">{initial ? `Change ${initial.code}` : 'New promo code'}</p>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code (what the customer types)">
          <div className="flex gap-2">
            <input
              className={`${input} font-mono uppercase tracking-wider`}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase().replace(/\s/g, ''))}
              placeholder="SUMMER15"
              required
            />
            <button type="button" className="btn btn-ghost btn-sm shrink-0" onClick={() => setCode(randomCode())}>
              Make one
            </button>
          </div>
        </Field>
        <Field label="Discount">
          <div className="flex gap-2">
            <select className={`${input} w-36`} value={type} onChange={(e) => setType(e.target.value as 'PERCENTAGE' | 'FIXED')}>
              <option value="PERCENTAGE">Percent off</option>
              <option value="FIXED">Euros off</option>
            </select>
            <input className={input} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={type === 'PERCENTAGE' ? '10' : '5.00'} required />
          </div>
        </Field>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Minimum order (€)" hint="Empty for no minimum.">
          <input className={input} inputMode="decimal" value={minOrder} onChange={(e) => setMinOrder(e.target.value)} placeholder="30.00" />
        </Field>
        <Field label="Uses in total" hint="Empty for unlimited.">
          <input className={input} inputMode="numeric" value={maxUses} onChange={(e) => setMaxUses(e.target.value)} placeholder="100" />
        </Field>
        <Field label="Uses per customer" hint="Empty for unlimited.">
          <input className={input} inputMode="numeric" value={perCustomer} onChange={(e) => setPerCustomer(e.target.value)} placeholder="1" />
        </Field>
      </div>

      <Field label="Only when the bag has something from (optional)" hint="Everything inside the category counts too.">
        <SearchSelect
          value={categoryId}
          onChange={setCategoryId}
          ariaLabel="Category"
          searchPlaceholder="Search categories"
          options={[{ value: '', label: 'Any product' }, ...categories.map((c) => ({ value: c.id, label: c.label }))]}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Starts">
          <DateTimeField value={startsAt} onChange={setStartsAt} ariaLabel="Starts" />
        </Field>
        <Field label="Expires (empty for never)">
          <DateTimeField value={expiresAt} onChange={setExpiresAt} ariaLabel="Expires" placeholder="Never" />
        </Field>
      </div>

      {error && <p className="text-sm text-sale">{error}</p>}
      <div className="flex gap-2">
        <button className={btn.primary} disabled={busy || code.trim().length < 3 || !(value > 0)}>
          {busy ? 'Saving' : initial ? 'Save changes' : 'Create code'}
        </button>
        <button type="button" className={btn.quiet} onClick={onDone}>
          Cancel
        </button>
      </div>
    </form>
  )
}

function Row({ c, categories }: { c: AdminPromoCode; categories: Option[] }) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const act = async (method: string, body?: unknown) => {
    setBusy(true)
    setError(null)
    const err = await call(`/api/admin/promo-codes/${c.id}`, method, body)
    setBusy(false)
    setConfirm(false)
    if (err) setError(err)
    else router.refresh()
  }
  if (editing) return <CodeForm initial={c} categories={categories} onDone={() => setEditing(false)} />
  const s = STATE[c.state]
  const rules = [
    c.minOrderCents ? `orders over ${euro(c.minOrderCents)}` : null,
    c.category ? `bag has ${c.category}` : null,
    c.maxUsesPerUser ? `${c.maxUsesPerUser} per customer` : null,
  ].filter(Boolean)

  return (
    <li className={`rounded-2xl border border-line bg-paper p-5 ${c.state === 'live' || c.state === 'scheduled' ? '' : 'opacity-70'}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              title="Copy"
              onClick={() => {
                void navigator.clipboard?.writeText(c.code)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              className="rounded-lg border border-dashed border-accent/60 bg-accent/10 px-3 py-1 font-mono text-base font-semibold tracking-wider text-heading hover:border-accent"
            >
              {c.code}
            </button>
            {copied && <span className="text-xs text-ok">Copied</span>}
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold tracking-wide uppercase ${s.cls}`}>{s.label}</span>
          </div>
          <p className="mt-2 text-sm">
            <span className="font-semibold text-accent">{c.discountType === 'PERCENTAGE' ? `${c.discountValue}% off` : `${euro(c.discountValue)} off`}</span>
            <span className="text-muted"> the bag{rules.length ? `, ${rules.join(', ')}` : ''}</span>
          </p>
          <p className="mt-1 text-xs text-muted">
            Used {c.timesUsed}
            {c.maxUses ? ` of ${c.maxUses}` : ''} time{c.timesUsed === 1 && !c.maxUses ? '' : 's'} · from {when(c.startsAt)}
            {c.expiresAt ? ` until ${when(c.expiresAt)}` : ', never expires'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>
            Change
          </button>
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => act('PATCH', { action: c.isActive ? 'off' : 'on' })}>
            {c.isActive ? 'Turn off' : 'Turn on'}
          </button>
          {c.timesUsed === 0 &&
            (!confirm ? (
              <button type="button" className="btn btn-ghost btn-sm text-sale" onClick={() => setConfirm(true)}>
                Delete
              </button>
            ) : (
              <>
                <button type="button" className={btn.danger} disabled={busy} onClick={() => act('DELETE')}>
                  Yes, delete
                </button>
                <button type="button" className={btn.quiet} onClick={() => setConfirm(false)}>
                  Keep
                </button>
              </>
            ))}
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-sale">{error}</p>}
    </li>
  )
}

export function PromoCodeManager({ codes, categories }: { codes: AdminPromoCode[]; categories: Option[] }) {
  const [adding, setAdding] = useState(false)
  const [q, setQ] = useState('')
  const shown = q.trim() ? codes.filter((c) => c.code.includes(q.trim().toUpperCase())) : codes
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {!adding && (
          <button type="button" className={btn.primary} onClick={() => setAdding(true)}>
            + New promo code
          </button>
        )}
        {codes.length > 5 && (
          <input type="search" className={`${input} max-w-xs rounded-full`} placeholder="Search codes" value={q} onChange={(e) => setQ(e.target.value)} />
        )}
      </div>
      {adding && <CodeForm categories={categories} onDone={() => setAdding(false)} />}
      {shown.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line bg-paper px-6 py-12 text-center text-sm text-muted">
          {codes.length ? 'No code matches.' : 'No promo codes yet.'}
        </p>
      ) : (
        <Paged as="ul" className="space-y-3">
          {shown.map((c) => (
            <Row key={c.id} c={c} categories={categories} />
          ))}
        </Paged>
      )}
    </div>
  )
}
