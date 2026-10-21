/* The /link card has its own bare shell: no header, no footer, no chat
   button. Like /admin it sits outside [locale], and src/proxy.ts leaves it
   alone, so the address stays exactly /link for the Instagram bio. */

import type { Viewport } from 'next'
import { BRAND } from '@/config/brand'
import '../globals.css'

export const viewport: Viewport = {
  themeColor: BRAND.theme.paper,
  colorScheme: 'dark',
}

export default function LinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="bg-paper">
      <body className="bg-paper text-ink">{children}</body>
    </html>
  )
}
