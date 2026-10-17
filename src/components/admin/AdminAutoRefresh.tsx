'use client'

/* Keeps the admin current without pressing F5: new orders, unread chats and
   the menu badges update when you come back to the tab, and every minute
   while it is open. It never interrupts typing: if a box has focus, it waits. */

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const typing = () => {
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)
}

export function AdminAutoRefresh({ everySeconds = 60 }: { everySeconds?: number }) {
  const router = useRouter()
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible' && !typing()) router.refresh()
    }
    const onVisible = () => document.visibilityState === 'visible' && refresh()
    const timer = setInterval(refresh, everySeconds * 1000)
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [router, everySeconds])
  return null
}
