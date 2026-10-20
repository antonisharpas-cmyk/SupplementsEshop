'use client'

/* One item of the desktop menu with its hover dropdown. The dropdown opens
   on hover or keyboard focus (CSS). Choosing a link closes it: the page
   changes without a reload, so the menu would otherwise stay open under the
   pointer, or keep focus. It opens again once the pointer leaves and comes
   back. */

import { useState } from 'react'

export function NavGroup({ children }: { children: React.ReactNode }) {
  const [closed, setClosed] = useState(false)
  return (
    <div
      data-closed={closed || undefined}
      className="group relative flex items-center py-3"
      onClickCapture={(e) => {
        if ((e.target as HTMLElement).closest('a')) {
          setClosed(true)
          ;(document.activeElement as HTMLElement | null)?.blur()
        }
      }}
      onMouseLeave={() => setClosed(false)}
      onFocus={(e) => {
        /* Keyboard users tabbing back in get it again. */
        if (e.target.matches(':focus-visible')) setClosed(false)
      }}
    >
      {children}
    </div>
  )
}
