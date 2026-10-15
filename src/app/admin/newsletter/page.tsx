/* The newsletter moved into Marketing & Emails; old links and bookmarks land
   in the right place. */

import { redirect } from 'next/navigation'

export default async function NewsletterMoved({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams
  redirect(sp.status || sp.q ? `/admin/emails/subscribers?${new URLSearchParams(sp as Record<string, string>)}` : '/admin/emails/campaigns')
}
