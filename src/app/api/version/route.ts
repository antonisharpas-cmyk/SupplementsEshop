/* GET /api/version: which build the server is running. Open tabs compare it
   with their own and reload when a new version has gone live. */

export const dynamic = 'force-dynamic'

export function GET() {
  return Response.json(
    { version: process.env.NEXT_PUBLIC_APP_VERSION ?? null },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
