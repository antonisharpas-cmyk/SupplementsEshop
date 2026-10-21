import type { NextConfig } from 'next'

/* Sent with every response. They cost nothing and close whole classes of
   attack: the shop cannot be framed by another site (clickjacking), browsers
   do not guess file types, links out do not carry full addresses (guest order
   links hold a secret token), and HTTPS is remembered once seen. */
const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
  },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(self)' },
]

/* The version of this build. Open tabs compare it with the server's
   (/api/version) and reload themselves when a new version is live. */
const version = process.env.NEXT_DEPLOYMENT_ID || process.env.RENDER_GIT_COMMIT || String(Date.now())

const nextConfig: NextConfig = {
  poweredByHeader: false,
  env: { NEXT_PUBLIC_APP_VERSION: version },
  /* A new deploy makes open tabs reload onto the new version instead of
     breaking on files the old version needed ("press refresh" errors).
     Render sets RENDER_GIT_COMMIT; elsewhere set NEXT_DEPLOYMENT_ID. */
  deploymentId: process.env.NEXT_DEPLOYMENT_ID || process.env.RENDER_GIT_COMMIT || undefined,
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
