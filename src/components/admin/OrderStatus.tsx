/* An order's status and payment, as small labels for the admin lists. */

import { Pill } from './ui'

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'New, to confirm',
  PAYMENT_PENDING: 'Awaiting card payment',
  PAID: 'Paid, to prepare',
  PROCESSING: 'Preparing',
  READY_FOR_PICKUP: 'Ready to collect',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  REFUNDED: 'Refunded',
}

export function OrderStatusPill({ status }: { status: string }) {
  const tone =
    status === 'PENDING' || status === 'PAID'
      ? 'warn'
      : status === 'DELIVERED'
        ? 'ok'
        : status === 'CANCELLED' || status === 'REFUNDED' || status === 'PAYMENT_PENDING'
          ? 'off'
          : 'ok'
  return <Pill tone={tone}>{STATUS_LABEL[status] ?? status}</Pill>
}

export function PaymentPill({ method, status }: { method: string; status: string | null }) {
  const m = method === 'card' ? 'Card' : 'Cash'
  if (status === 'SUCCEEDED') return <Pill tone="ok">{m} · paid</Pill>
  if (status === 'REFUNDED' || status === 'PARTIALLY_REFUNDED') return <Pill tone="off">{m} · refunded</Pill>
  if (status === 'CANCELLED' || status === 'FAILED') return <Pill tone="off">{m} · {status.toLowerCase()}</Pill>
  return <Pill tone="warn">{m} · unpaid</Pill>
}
