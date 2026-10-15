/* The header bag badge and the things that change the bag talk through one
   browser event, so the count moves the moment the server answers — not a
   round-trip later when the page re-renders. The server's number is the only
   one ever announced; nothing here counts items itself. */

export const BAG_EVENT = 'bag:count'

export function announceBagCount(count: unknown) {
  if (typeof window === 'undefined') return
  if (typeof count !== 'number' || !Number.isFinite(count) || count < 0) return
  window.dispatchEvent(new CustomEvent(BAG_EVENT, { detail: { count: Math.floor(count) } }))
}
