'use client'

/* ============================================================================
 * Drag-and-drop reordering, for the admin panel.
 *
 * Written here rather than installed: it is one well-understood interaction,
 * and a dependency would mean one more `npm install` between the shop owner
 * and a working admin panel.
 *
 * How it behaves:
 *   · Mouse — grab any card and drag. Other cards slide out of the way as you
 *     go (a FLIP animation: measure, move, animate the difference), and the
 *     gap you left shows as a dashed outline.
 *   · Touch — drag by the ⠿ handle. Swiping anywhere else still scrolls the
 *     page, which is what a thumb on a phone expects.
 *   · Keyboard — Tab to a handle, then the arrow keys move the item one place,
 *     Home and End move it to either end. Each move is announced to screen
 *     readers ("Boxy Cotton Tee, position 3 of 8").
 *   · Escape while dragging puts everything back where it was.
 *   · Near the top or bottom of the window, the page scrolls with you.
 *
 * Nothing is saved while you drag. `onChange` fires once, when you let go, with
 * the complete new order — so the caller saves one list, not a stream of moves.
 * ========================================================================== */

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'

export type HandleProps = {
  ref: (el: HTMLButtonElement | null) => void
  onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void
  onPointerDown: (e: ReactPointerEvent<HTMLButtonElement>) => void
  'aria-label': string
  'aria-roledescription': string
  'data-drag-handle': true
  style: { touchAction: 'none'; cursor: 'grab' }
  type: 'button'
}

type Props<T> = {
  items: T[]
  getId: (item: T) => string
  /** Human name of an item, for the screen-reader announcement. */
  describe: (item: T) => string
  onChange: (next: T[]) => void
  renderItem: (item: T, state: { index: number; dragging: boolean; handle: HandleProps }) => ReactNode
  /** Layout of the container — a grid or a column; the component doesn't care. */
  className?: string
  itemClassName?: string
  disabled?: boolean
}

type Drag = {
  id: string
  pointerId: number
  startX: number
  startY: number
  lastX: number
  lastY: number
  grabX: number
  grabY: number
  started: boolean
  original: string[]
}

const MOVE_THRESHOLD = 5
const EDGE = 72
const EASE = 'transform 220ms cubic-bezier(0.2, 0.7, 0.2, 1)'

function reducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function Sortable<T>({
  items,
  getId,
  describe,
  onChange,
  renderItem,
  className,
  itemClassName,
  disabled,
}: Props<T>) {
  const byId = new Map(items.map((item) => [getId(item), item]))
  const [preview, setPreviewState] = useState<string[] | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')

  const order = preview ?? items.map(getId)

  const slots = useRef(new Map<string, HTMLDivElement>())
  const inners = useRef(new Map<string, HTMLDivElement>())
  const handles = useRef(new Map<string, HTMLButtonElement>())
  const drag = useRef<Drag | null>(null)
  const previewRef = useRef<string[] | null>(null)
  const beforeRects = useRef<Map<string, DOMRect> | null>(null)
  const focusAfter = useRef<string | null>(null)

  /* Window listeners have to be stable to be removable, yet need the latest
     props: so the props are read through a ref, updated after every render. */
  const latest = useRef({ items, getId, describe, onChange })
  useEffect(() => {
    latest.current = { items, getId, describe, onChange }
  })

  const setPreview = (list: string[] | null) => {
    previewRef.current = list
    setPreviewState(list)
  }

  /* --------------------------------------------------------------- FLIP -- */

  const snapshot = () => {
    const rects = new Map<string, DOMRect>()
    for (const [id, el] of slots.current) rects.set(id, el.getBoundingClientRect())
    beforeRects.current = rects
  }

  /** Put the dragged card under the pointer, wherever its slot now is. */
  const placeDragged = () => {
    const d = drag.current
    if (!d?.started) return
    const slot = slots.current.get(d.id)
    const inner = inners.current.get(d.id)
    if (!slot || !inner) return
    const r = slot.getBoundingClientRect()
    inner.style.transition = 'none'
    inner.style.transform = `translate3d(${d.lastX - d.grabX - r.left}px, ${d.lastY - d.grabY - r.top}px, 0) scale(1.03)`
  }

  const orderKey = order.join('|')
  useLayoutEffect(() => {
    const before = beforeRects.current
    beforeRects.current = null
    if (before && !reducedMotion()) {
      for (const [id, slot] of slots.current) {
        if (drag.current?.started && id === drag.current.id) continue
        const was = before.get(id)
        const inner = inners.current.get(id)
        if (!was || !inner) continue
        const now = slot.getBoundingClientRect()
        const dx = was.left - now.left
        const dy = was.top - now.top
        if (!dx && !dy) continue
        inner.style.transition = 'none'
        inner.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
        void inner.getBoundingClientRect()
        inner.style.transition = EASE
        inner.style.transform = ''
      }
    }
    placeDragged()
    if (focusAfter.current) {
      handles.current.get(focusAfter.current)?.focus()
      focusAfter.current = null
    }
  }, [orderKey])

  /* ------------------------------------------------------------ pointer -- */

  /* Created once. Everything they need is in refs. */
  const listeners = useRef<{
    move: (e: PointerEvent) => void
    up: (e: PointerEvent) => void
    cancel: () => void
    key: (e: KeyboardEvent) => void
  } | null>(null)

  const detach = () => {
    const l = listeners.current
    if (!l) return
    window.removeEventListener('pointermove', l.move)
    window.removeEventListener('pointerup', l.up)
    window.removeEventListener('pointercancel', l.cancel)
    window.removeEventListener('keydown', l.key)
    document.body.style.userSelect = ''
    document.body.style.cursor = ''
  }

  const finish = (commit: boolean) => {
    const d = drag.current
    drag.current = null
    detach()
    if (!d?.started) return

    const inner = inners.current.get(d.id)
    if (inner) {
      /* Settle into the slot rather than snapping to it. */
      inner.style.transition = reducedMotion() ? 'none' : EASE
      inner.style.transform = ''
    }

    const current = previewRef.current
    const changed = commit && current && current.join('|') !== d.original.join('|')
    if (!commit) snapshot()
    setPreview(null)
    setDragId(null)

    if (changed && current) {
      const { items: all, getId: idOf, describe: name, onChange: emit } = latest.current
      const lookup = new Map(all.map((it) => [idOf(it), it]))
      const next = current.map((id) => lookup.get(id)).filter((it): it is T => it !== undefined)
      const moved = lookup.get(d.id)
      if (moved) setAnnouncement(`${name(moved)}, position ${current.indexOf(d.id) + 1} of ${current.length}.`)
      emit(next)
    }
  }

  const move = (e: PointerEvent) => {
    const d = drag.current
    if (!d || e.pointerId !== d.pointerId) return
    d.lastX = e.clientX
    d.lastY = e.clientY

    if (!d.started) {
      if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < MOVE_THRESHOLD) return
      const slot = slots.current.get(d.id)
      if (!slot) return
      const r = slot.getBoundingClientRect()
      d.grabX = d.startX - r.left
      d.grabY = d.startY - r.top
      d.started = true
      document.body.style.userSelect = 'none'
      document.body.style.cursor = 'grabbing'
      setDragId(d.id)
      setPreview(d.original)
    }
    e.preventDefault()

    /* Scroll when the pointer nears the window's edge. */
    if (e.clientY < EDGE) window.scrollBy(0, -Math.ceil((EDGE - e.clientY) / 4))
    else if (e.clientY > window.innerHeight - EDGE)
      window.scrollBy(0, Math.ceil((e.clientY - (window.innerHeight - EDGE)) / 4))

    placeDragged()

    /* Which slot is the pointer over? */
    let target: string | null = null
    for (const [id, slot] of slots.current) {
      if (id === d.id) continue
      const r = slot.getBoundingClientRect()
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
        target = id
        break
      }
    }
    if (!target) return

    const list = previewRef.current ?? d.original
    const from = list.indexOf(d.id)
    const to = list.indexOf(target)
    if (from < 0 || to < 0 || from === to) return
    snapshot()
    const next = [...list]
    next.splice(from, 1)
    next.splice(to, 0, d.id)
    setPreview(next)
  }

  /* Keep the listener object pointing at this render's functions; the window
     only ever holds the wrappers below, which never change. */
  const impl = useRef({ move, finish })
  useEffect(() => {
    impl.current = { move, finish }
  })
  useEffect(() => {
    listeners.current = {
      move: (e) => impl.current.move(e),
      up: (e) => {
        if (drag.current && e.pointerId === drag.current.pointerId) impl.current.finish(true)
      },
      cancel: () => impl.current.finish(false),
      key: (e) => {
        if (e.key === 'Escape') impl.current.finish(false)
      },
    }
    /* Leaving the page mid-drag must not leave listeners or a frozen cursor. */
    return () => detach()
  }, [])

  function begin(e: ReactPointerEvent, id: string, fromHandle: boolean) {
    if (disabled || e.button !== 0 || drag.current) return
    const target = e.target as HTMLElement
    /* Buttons and links inside a card keep working as buttons and links. */
    if (!fromHandle && target.closest('button, a, input, select, textarea, [data-no-drag]')) return
    /* On touch, only the handle drags — the rest of the card scrolls the page. */
    if (e.pointerType !== 'mouse' && !fromHandle) return
    if (e.pointerType === 'mouse') e.preventDefault()

    drag.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      grabX: 0,
      grabY: 0,
      started: false,
      original: items.map(getId),
    }
    const l = listeners.current
    if (!l) return
    window.addEventListener('pointermove', l.move, { passive: false })
    window.addEventListener('pointerup', l.up)
    window.addEventListener('pointercancel', l.cancel)
    window.addEventListener('keydown', l.key)
  }

  /* ----------------------------------------------------------- keyboard -- */

  function keyMove(e: ReactKeyboardEvent, id: string) {
    if (disabled) return
    const list = items.map(getId)
    const from = list.indexOf(id)
    let to = from
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') to = from - 1
    else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') to = from + 1
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = list.length - 1
    else return
    e.preventDefault()
    to = Math.max(0, Math.min(list.length - 1, to))
    if (to === from) return

    snapshot()
    const next = [...items]
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    focusAfter.current = id
    setAnnouncement(`${describe(moved)}, position ${to + 1} of ${list.length}.`)
    onChange(next)
  }

  /* ------------------------------------------------------------- render -- */

  return (
    <>
      <div className={className} role="list">
        {order.map((id, index) => {
          const item = byId.get(id)
          if (!item) return null
          const dragging = dragId === id
          const handle: HandleProps = {
            ref: (el) => {
              if (el) handles.current.set(id, el)
              else handles.current.delete(id)
            },
            onKeyDown: (e) => keyMove(e, id),
            onPointerDown: (e) => {
              e.stopPropagation()
              begin(e, id, true)
            },
            'aria-label': `Move ${describe(item)}. Use the arrow keys, or drag.`,
            'aria-roledescription': 'sortable',
            'data-drag-handle': true,
            style: { touchAction: 'none', cursor: 'grab' },
            type: 'button',
          }
          return (
            <div
              key={id}
              role="listitem"
              ref={(el) => {
                if (el) slots.current.set(id, el)
                else slots.current.delete(id)
              }}
              onPointerDown={(e) => begin(e, id, false)}
              className={`relative ${itemClassName ?? ''} ${disabled ? '' : 'cursor-grab'}`}
            >
              {dragging && (
                <div
                  aria-hidden="true"
                  className="absolute inset-0 rounded-sm border-2 border-dashed border-ink/25 bg-black/[0.03]"
                />
              )}
              <div
                ref={(el) => {
                  if (el) inners.current.set(id, el)
                  else inners.current.delete(id)
                }}
                className={`relative h-full ${dragging ? 'pointer-events-none z-50 shadow-2xl' : ''}`}
                style={{ willChange: dragging ? 'transform' : undefined }}
              >
                <ItemView render={renderItem} item={item} index={index} dragging={dragging} handle={handle} />
              </div>
            </div>
          )
        })}
      </div>
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </>
  )
}

/* A component boundary, so the item's markup is rendered by React rather than
   by calling a function mid-render with callbacks that touch refs. */
function ItemView<T>({
  render,
  item,
  index,
  dragging,
  handle,
}: {
  render: Props<T>['renderItem']
  item: T
  index: number
  dragging: boolean
  handle: HandleProps
}) {
  return <>{render(item, { index, dragging, handle })}</>
}

/** The ⠿ grip, for renderItem to place wherever suits the card. */
export function DragHandle({ handle, className = '' }: { handle: HandleProps; className?: string }) {
  const { ref, ...rest } = handle
  return (
    <button
      ref={ref}
      {...rest}
      className={`grid h-8 w-8 shrink-0 place-items-center rounded-sm text-muted transition hover:bg-black/5 hover:text-ink focus-visible:outline-2 focus-visible:outline-accent ${className}`}
    >
      <svg width="12" height="16" viewBox="0 0 12 16" aria-hidden="true">
        {[2, 7, 12].map((y) =>
          [3, 9].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y + 0.5} r="1.4" fill="currentColor" />),
        )}
      </svg>
    </button>
  )
}
