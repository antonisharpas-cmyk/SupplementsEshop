'use client'

/* Admin, Settings: the state of card payments (Stripe) and BOX NOW lockers.
   Secrets are never shown or edited here: they live in the server's
   environment (Render, Environment), where only the owner can see them. */

import { useState } from 'react'
import { btn } from './ui'

type Origin = { id: string; name: string; address: string }

function Row({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <span aria-hidden className={ok ? 'text-ok' : 'text-sale'}>
        {ok ? '✓' : '✗'}
      </span>
      <span>{children}</span>
    </li>
  )
}

export function IntegrationsPanel({
  stripe,
  boxnow,
}: {
  stripe: { mode: 'test' | 'live' | 'off'; webhook: boolean; webhookUrl: string }
  boxnow: { checkout: boolean; api: boolean; canShip: boolean; missing: string[]; stage: boolean; cod: boolean; webhookUrl: string; token: boolean }
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ error?: string; origins?: Origin[]; lockers?: number } | null>(null)

  async function test() {
    setBusy(true)
    setResult(null)
    try {
      const res = await fetch('/api/admin/boxnow', { cache: 'no-store' })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; origins?: Origin[]; lockers?: number }
      setResult(res.ok && data.ok ? { origins: data.origins, lockers: data.lockers } : { error: data.message ?? 'That did not work.' })
    } catch {
      setResult({ error: 'Could not reach the server.' })
    }
    setBusy(false)
  }

  return (
    <div className="mt-10 grid gap-6 lg:grid-cols-2">
      <section className="rounded-2xl border border-line bg-paper p-5 text-sm">
        <h2 className="label mb-3 text-muted">Card payments (Stripe)</h2>
        <ul className="space-y-1.5">
          <Row ok={stripe.mode !== 'off'}>
            {stripe.mode === 'test'
              ? 'Test mode. Card payment is offered at checkout; no real money is taken (test card 4242 4242 4242 4242).'
              : stripe.mode === 'live'
                ? 'LIVE mode. Real payments are taken.'
                : 'Off. Set STRIPE_SECRET_KEY to the test secret key (sk_test_…). Live keys are refused.'}
          </Row>
          <Row ok={stripe.webhook}>
            {stripe.webhook ? 'Webhook secret set.' : 'STRIPE_WEBHOOK_SECRET not set. Payments still confirm when the customer returns from Stripe, but set it so a closed tab is caught too.'}
          </Row>
        </ul>
        <p className="mt-3 text-xs text-muted">
          Stripe webhook address: <span className="font-mono text-ink">{stripe.webhookUrl}</span>
        </p>
      </section>

      <section className="rounded-2xl border border-line bg-paper p-5 text-sm">
        <h2 className="label mb-3 text-muted">BOX NOW lockers</h2>
        <ul className="space-y-1.5">
          <Row ok={boxnow.api}>{boxnow.api ? `API credentials set (${boxnow.stage ? 'stage, for testing' : 'production'}).` : 'API credentials missing.'}</Row>
          <Row ok={boxnow.canShip}>{boxnow.canShip ? 'Warehouse set: shipments can be created.' : 'Warehouse (BOXNOW_WAREHOUSE_ID) missing.'}</Row>
          <Row ok={boxnow.checkout}>{boxnow.checkout ? 'Offered at checkout.' : 'Not offered at checkout until every setting is in place.'}</Row>
          <Row ok={true}>{boxnow.cod ? 'Cash on delivery at the locker: allowed.' : 'Locker orders are paid by card (BOXNOW_COD not set).'}</Row>
        </ul>
        {boxnow.missing.length > 0 && (
          <p className="mt-3 text-xs text-ink-soft">
            Missing: <span className="font-mono">{boxnow.missing.join(', ')}</span>
          </p>
        )}
        <p className="mt-3 text-xs text-muted">
          Webhook address to give BOX NOW: <span className="font-mono text-ink">{boxnow.webhookUrl}{boxnow.token ? '?token=…' : ''}</span>
        </p>
        <button type="button" className={`${btn.secondary} mt-4`} disabled={busy || !boxnow.api} onClick={() => void test()}>
          {busy ? 'Testing…' : 'Test connection'}
        </button>
        {result?.error && <p className="mt-3 text-xs text-sale">{result.error}</p>}
        {result?.origins && (
          <div className="mt-3 text-xs">
            <p className="text-ok">Connected. {result.lockers} lockers available.</p>
            <p className="mt-2 text-muted">Your warehouses (use the id as BOXNOW_WAREHOUSE_ID):</p>
            <ul className="mt-1 space-y-0.5">
              {result.origins.length === 0 && <li className="text-muted">None on this account yet. Ask BOX NOW to add one.</li>}
              {result.origins.map((o) => (
                <li key={o.id}>
                  <span className="font-mono text-heading">{o.id}</span> {o.name} {o.address && `· ${o.address}`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  )
}
