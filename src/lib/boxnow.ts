/* ============================================================================
 * BOX NOW, parcel lockers. The API client and its settings.
 *
 * Built from BOX NOW's Partner API manual (v7, Cyprus edition) and the calls
 * their official WooCommerce plugin makes:
 *
 *   POST /api/v1/auth-sessions            client id + secret → Bearer token (1 h)
 *   GET  /api/v1/destinations             lockers (id, name, address, postcode)
 *   GET  /api/v1/origins                  the shop's warehouse(s)
 *   POST /api/v1/delivery-requests        create a shipment → parcel id(s)
 *   GET  /api/v1/parcels?parcelId=…       a parcel's state and events
 *   GET  /api/v1/parcels/{id}/label.pdf   the label to stick on the box
 *   POST /api/v1/parcels/{id}:cancel      cancel a parcel not yet handed over
 *
 * Nothing here pretends. Until BOX NOW has given us an account, the option is
 * not offered at checkout and the admin says exactly which settings are
 * missing; every API error is passed on with BOX NOW's own code (P400 …).
 *
 * Settings (Render, Environment; or .env.local):
 *   BOXNOW_API_URL        host BOX NOW gives you, e.g. api-stage.boxnow.gr
 *                         (test) or api-production.boxnow.gr (live)
 *   BOXNOW_CLIENT_ID      } API credentials, separate for stage and production
 *   BOXNOW_CLIENT_SECRET  }
 *   BOXNOW_WAREHOUSE_ID   the origin location id (Admin, Settings, BOX NOW
 *                         lists them once the credentials work)
 *   BOXNOW_PARTNER_ID     for the locker map at checkout
 *   BOXNOW_WIDGET_URL     optional, default https://widget-v5.boxnow.cy
 *   BOXNOW_COD            "yes" if the contract allows cash on delivery at
 *                         the locker; otherwise locker orders are paid by card
 *   BOXNOW_WEBHOOK_TOKEN  optional secret added to the webhook address
 *   BOXNOW_SENDER_PHONE / BOXNOW_SENDER_EMAIL  the shop's contact on the
 *                         parcel, if different from src/config/brand.ts
 * ========================================================================== */

import { BRAND } from '@/config/brand'

/* ------------------------------------------------------------- settings -- */

function env(name: string) {
  return process.env[name]?.trim() || ''
}

export function boxnowConfig() {
  const host = env('BOXNOW_API_URL')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '')
  return {
    apiBase: host ? `https://${host}` : '',
    clientId: env('BOXNOW_CLIENT_ID'),
    clientSecret: env('BOXNOW_CLIENT_SECRET'),
    warehouseId: env('BOXNOW_WAREHOUSE_ID'),
    partnerId: env('BOXNOW_PARTNER_ID'),
    widgetUrl: (env('BOXNOW_WIDGET_URL') || 'https://widget-v5.boxnow.cy').replace(/\/+$/, ''),
    cod: env('BOXNOW_COD') === 'yes',
    webhookToken: env('BOXNOW_WEBHOOK_TOKEN'),
    senderPhone: env('BOXNOW_SENDER_PHONE') || BRAND.contact.phone,
    senderEmail: env('BOXNOW_SENDER_EMAIL') || BRAND.contact.email,
    stage: /stage/i.test(host),
  }
}

/** What works and what is missing, for the admin and for checkout. */
export function boxnowStatus() {
  const c = boxnowConfig()
  const missing: string[] = []
  if (!c.apiBase) missing.push('BOXNOW_API_URL')
  if (!c.clientId) missing.push('BOXNOW_CLIENT_ID')
  if (!c.clientSecret) missing.push('BOXNOW_CLIENT_SECRET')
  if (!c.warehouseId) missing.push('BOXNOW_WAREHOUSE_ID')
  if (!c.partnerId) missing.push('BOXNOW_PARTNER_ID')
  const api = Boolean(c.apiBase && c.clientId && c.clientSecret)
  return {
    /** Lockers can be offered at checkout: the map works and orders can be shipped. */
    checkout: missing.length === 0,
    /** The API can be called (test connection, labels, tracking). */
    api,
    canShip: api && Boolean(c.warehouseId),
    missing,
    stage: c.stage,
    cod: c.cod,
  }
}

/** Only messages from BOX NOW's own widget are believed. */
export const BOXNOW_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*boxnow\.(cy|gr|bg|hr)$/

/* ---------------------------------------------------------------- errors -- */

export class BoxNowError extends Error {
  constructor(
    message: string,
    /** BOX NOW's own code (P400, P402 …) when it gave one. */
    public code: string | null = null,
    public status = 0,
  ) {
    super(message)
    this.name = 'BoxNowError'
  }
}

/* What BOX NOW's codes mean, in words staff can act on. */
const MEANING: Record<string, string> = {
  P400: 'BOX NOW rejected the request data.',
  P401: 'The warehouse (BOXNOW_WAREHOUSE_ID) is not valid for this account.',
  P402: 'The chosen locker is not valid. Ask the customer to choose another locker.',
  P403: 'This account may not use that locker type.',
  P404: 'The request is not in the format BOX NOW expects.',
  P405: 'A phone number is not in full international format (+357…).',
  P406: 'That parcel size is not accepted.',
  P407: 'The country is not served by this account.',
  P410: 'BOX NOW already has a shipment with this order number.',
  P411: 'This account is not allowed cash on delivery. Set BOXNOW_COD only if the contract includes it.',
  P420: 'The parcel can no longer be cancelled (already handed over or delivered).',
}

/* ------------------------------------------------------------------ auth -- */

let token: { value: string; expires: number; key: string } | null = null

async function accessToken(): Promise<string> {
  const c = boxnowConfig()
  if (!c.apiBase || !c.clientId || !c.clientSecret) {
    throw new BoxNowError(`BOX NOW is not set up. Missing: ${boxnowStatus().missing.join(', ')}.`)
  }
  const key = `${c.apiBase}|${c.clientId}`
  if (token && token.key === key && token.expires > Date.now() + 60_000) return token.value

  const res = await fetchWithTimeout(`${c.apiBase}/api/v1/auth-sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ grant_type: 'client_credentials', client_id: c.clientId, client_secret: c.clientSecret }),
  })
  const data = (await res.json().catch(() => null)) as { access_token?: string; expires_in?: number } | null
  if (!res.ok || !data?.access_token) {
    throw new BoxNowError(
      res.status === 401 || res.status === 400
        ? 'BOX NOW refused the client id or secret. Check BOXNOW_CLIENT_ID, BOXNOW_CLIENT_SECRET and that BOXNOW_API_URL is the matching environment (stage or production).'
        : res.status === 403
          ? 'BOX NOW says this account is disabled.'
          : `BOX NOW sign in failed (HTTP ${res.status}).`,
      null,
      res.status,
    )
  }
  token = { value: data.access_token, expires: Date.now() + (data.expires_in ?? 3600) * 1000, key }
  return token.value
}

async function fetchWithTimeout(url: string, init: RequestInit, ms = 20_000) {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(ms), cache: 'no-store' })
  } catch (err) {
    throw new BoxNowError(`Could not reach BOX NOW (${err instanceof Error ? err.message : 'network error'}).`)
  }
}

/** One authenticated call. Retries once with a fresh token on 401. */
async function call(path: string, init: RequestInit & { accept?: string } = {}, retry = true): Promise<Response> {
  const c = boxnowConfig()
  const res = await fetchWithTimeout(`${c.apiBase}${path}`, {
    ...init,
    headers: {
      Accept: init.accept ?? 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${await accessToken()}`,
      ...(init.headers ?? {}),
    },
  })
  if (res.status === 401 && retry) {
    token = null
    return call(path, init, false)
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { code?: string; message?: string; detail?: string } | null
    const code = body?.code && /^P\d{3}$/.test(body.code) ? body.code : null
    const said = body?.message || body?.detail || ''
    throw new BoxNowError(
      [code ? `${code}: ${MEANING[code] ?? 'BOX NOW refused the request.'}` : `BOX NOW error (HTTP ${res.status}).`, said]
        .filter(Boolean)
        .join(' '),
      code,
      res.status,
    )
  }
  return res
}

/* ------------------------------------------------------------- locations -- */

export type BoxNowLocation = {
  id: string
  name: string
  title: string
  addressLine1: string
  addressLine2: string
  postalCode: string
  country: string
  lat: number | null
  lng: number | null
}

function toLocation(x: Record<string, unknown>): BoxNowLocation {
  const s = (v: unknown) => (v == null ? '' : String(v))
  return {
    id: s(x.id),
    name: s(x.name),
    title: s(x.title),
    addressLine1: s(x.addressLine1),
    addressLine2: s(x.addressLine2),
    postalCode: s(x.postalCode),
    country: s(x.country),
    lat: x.lat == null ? null : Number(x.lat),
    lng: x.lng == null ? null : Number(x.lng),
  }
}

let lockers: { at: number; list: BoxNowLocation[] } | null = null

/** All lockers this account can deliver to, cached for six hours. */
export async function listLockers(): Promise<BoxNowLocation[]> {
  if (lockers && Date.now() - lockers.at < 6 * 3600_000) return lockers.list
  const res = await call('/api/v1/destinations?locationType=apm')
  const data = (await res.json()) as { data?: Record<string, unknown>[] }
  const list = (data.data ?? []).map(toLocation)
  lockers = { at: Date.now(), list }
  return list
}

export async function findLocker(id: string): Promise<BoxNowLocation | null> {
  return (await listLockers()).find((l) => l.id === id) ?? null
}

/** The shop's warehouses (origins), for the admin to pick BOXNOW_WAREHOUSE_ID. */
export async function listOrigins(): Promise<BoxNowLocation[]> {
  const res = await call('/api/v1/origins')
  const data = (await res.json()) as { data?: Record<string, unknown>[] }
  return (data.data ?? []).map(toLocation)
}

/* ------------------------------------------------------------- shipments -- */

/** International format BOX NOW insists on (P405). Cyprus numbers get +357. */
export function boxnowPhone(raw: string): string | null {
  let p = raw.replace(/[\s().-]/g, '')
  if (p.startsWith('00')) p = `+${p.slice(2)}`
  if (/^(2[2-6]|9[4-9])\d{6}$/.test(p)) p = `+357${p}`
  return /^\+(30|357|359|385)\d{7,12}$/.test(p) ? p : null
}

const euros = (cents: number) => (cents / 100).toFixed(2)

export type DeliveryRequestInput = {
  reference: string
  invoiceValueCents: number
  paymentMode: 'prepaid' | 'cod'
  amountToCollectCents: number
  lockerId: string
  compartmentSize: 1 | 2 | 3
  recipient: { name: string; phone: string; email: string }
  itemName: string
}

export async function createDeliveryRequest(input: DeliveryRequestInput): Promise<{ deliveryRequestId: string; parcelIds: string[] }> {
  const c = boxnowConfig()
  if (!c.warehouseId) throw new BoxNowError('BOXNOW_WAREHOUSE_ID is not set.')
  const senderPhone = boxnowPhone(c.senderPhone)
  if (!senderPhone) {
    throw new BoxNowError(
      `The shop phone "${c.senderPhone}" is not a full international number. Set BOXNOW_SENDER_PHONE (e.g. +35799123456) or the phone in src/config/brand.ts.`,
    )
  }
  const recipientPhone = boxnowPhone(input.recipient.phone)
  if (!recipientPhone) throw new BoxNowError(`The customer's phone "${input.recipient.phone}" is not a Cyprus or Greek mobile number BOX NOW accepts.`)

  const body = {
    orderNumber: input.reference,
    invoiceValue: euros(input.invoiceValueCents),
    paymentMode: input.paymentMode,
    amountToBeCollected: input.paymentMode === 'cod' ? euros(input.amountToCollectCents) : '0.00',
    allowReturn: true,
    notifyOnAccepted: '',
    origin: { contactName: BRAND.name, contactNumber: senderPhone, contactEmail: c.senderEmail, locationId: c.warehouseId },
    destination: {
      contactName: input.recipient.name,
      contactNumber: recipientPhone,
      contactEmail: input.recipient.email,
      locationId: input.lockerId,
    },
    items: [
      {
        id: input.reference,
        name: input.itemName.slice(0, 100),
        value: euros(input.invoiceValueCents),
        weight: 0,
        compartmentSize: input.compartmentSize,
      },
    ],
  }
  const res = await call('/api/v1/delivery-requests', { method: 'POST', body: JSON.stringify(body) })
  const data = (await res.json()) as { id?: string | number; referenceNumber?: string | number; parcels?: { id?: string | number }[] }
  const deliveryRequestId = String(data.id ?? data.referenceNumber ?? '')
  const parcelIds = (data.parcels ?? []).map((p) => String(p.id ?? '')).filter(Boolean)
  if (!parcelIds.length) throw new BoxNowError('BOX NOW accepted the request but returned no parcel number.')
  return { deliveryRequestId, parcelIds }
}

export type ParcelInfo = {
  id: string
  state: string
  events: { type: string; place: string; at: Date | null }[]
}

export async function getParcel(parcelId: string): Promise<ParcelInfo | null> {
  const res = await call(`/api/v1/parcels?parcelId=${encodeURIComponent(parcelId)}`)
  const data = (await res.json()) as { data?: Record<string, unknown>[] }
  const p = (data.data ?? []).find((x) => String(x.id) === parcelId) ?? data.data?.[0]
  if (!p) return null
  const events = ((p.events as Record<string, unknown>[] | undefined) ?? []).map((e) => ({
    type: String(e.type ?? ''),
    place: String(e.locationDisplayName ?? ''),
    at: e.createTime ? new Date(String(e.createTime)) : null,
  }))
  events.sort((a, b) => (a.at?.getTime() ?? 0) - (b.at?.getTime() ?? 0))
  return { id: String(p.id), state: String(p.state ?? ''), events }
}

export async function parcelLabel(parcelId: string): Promise<ArrayBuffer> {
  const res = await call(`/api/v1/parcels/${encodeURIComponent(parcelId)}/label.pdf`, { accept: 'application/pdf' })
  return res.arrayBuffer()
}

export async function cancelParcel(parcelId: string): Promise<void> {
  await call(`/api/v1/parcels/${encodeURIComponent(parcelId)}:cancel`, { method: 'POST', body: '{}' })
}

/** BOX NOW's public tracking page. The customer enters the parcel number there. */
export const BOXNOW_TRACKING_URL = 'https://boxnow.cy/en/track'

/** For tests: forget the cached token and lockers. */
export function resetBoxNowCache() {
  token = null
  lockers = null
}
