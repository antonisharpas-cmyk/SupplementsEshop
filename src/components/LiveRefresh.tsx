'use client'

/* The "hard refresh" for everyone, so nobody has to press Ctrl+F5.

   · New version live: when the site is updated, an open tab notices (it asks
     /api/version on coming back to the tab and every few minutes) and reloads
     itself fully onto the new version.
   · Fresh data: coming back to a tab after a while (stock, prices, the bag,
     new orders in admin) reloads the page's data in place, nothing is lost.
     With `everySeconds` it also does this on a timer while the tab is open.

   It never interrupts typing: if a box has focus, it waits for the next turn. */

import { useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'

const MINE = process.env.NEXT_PUBLIC_APP_VERSION ?? null
const VERSION_CHECK_MS = 5 * 60 * 1000

const typing = () => {
  const el = document.activeElement
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)
}

export function LiveRefresh({ everySeconds, afterAwaySeconds = 30 }: { everySeconds?: number; afterAwaySeconds?: number }) {
  const router = useRouter()
  const hiddenAt = useRef<number | null>(null)
  const lastVersionCheck = useRef(0)
  const newVersion = useRef(false)

  useEffect(() => {
    const checkVersion = async () => {
      if (!MINE || Date.now() - lastVersionCheck.current < 20_000) return
      lastVersionCheck.current = Date.now()
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        const { version } = (await res.json()) as { version: string | null }
        if (version && version !== MINE) newVersion.current = true
      } catch {
        /* offline or restarting: try again later */
      }
      if (newVersion.current && !typing()) window.location.reload()
    }

    const refreshData = () => {
      if (document.visibilityState === 'visible' && !typing()) router.refresh()
    }

    const onVisible = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt.current = Date.now()
        return
      }
      const away = hiddenAt.current ? (Date.now() - hiddenAt.current) / 1000 : 0
      hiddenAt.current = null
      void checkVersion()
      if (away >= afterAwaySeconds) refreshData()
    }

    /* A reload that waited for typing to finish happens once the box loses focus. */
    const onBlur = () => setTimeout(() => newVersion.current && !typing() && window.location.reload(), 0)

    const versionTimer = setInterval(() => document.visibilityState === 'visible' && void checkVersion(), VERSION_CHECK_MS)
    const dataTimer = everySeconds ? setInterval(refreshData, everySeconds * 1000) : null
    document.addEventListener('visibilitychange', onVisible)
    document.addEventListener('focusout', onBlur)
    return () => {
      clearInterval(versionTimer)
      if (dataTimer) clearInterval(dataTimer)
      document.removeEventListener('visibilitychange', onVisible)
      document.removeEventListener('focusout', onBlur)
    }
  }, [router, everySeconds, afterAwaySeconds])

  return null
}
