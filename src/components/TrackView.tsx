'use client'

/* Records one product view, once, after the page is interactive.
 *
 * Renders nothing. Deliberately fire-and-forget: if the request fails the
 * customer must never see it, because a view counter is not worth an error
 * message. keepalive lets it complete even if they navigate away immediately. */

import { useEffect, useRef } from 'react'
import { rememberProduct } from '@/lib/recent-store'

export function TrackView({ productId }: { productId: string }) {
  const sent = useRef<string | null>(null)

  useEffect(() => {
    /* Guard against double-invocation in development's strict mode, and
       against a re-render with the same product. */
    if (sent.current === productId) return
    sent.current = productId

    /* The device's own list, which is what powers the strip for a visitor the
       server has no identity for. */
    rememberProduct(productId)

    const timer = setTimeout(() => {
      void fetch('/api/products/views', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId }),
        keepalive: true,
      }).catch(() => {})
    }, 1200) /* a bounce back to the listing is not a view */

    return () => clearTimeout(timer)
  }, [productId])

  return null
}
