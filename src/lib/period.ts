/* A date range from the address bar, for partner results: ?period=this_month
   (the default), last_month, this_year, all, or ?from=YYYY-MM-DD&to=… */

export type PeriodKey = 'this_month' | 'last_month' | 'this_year' | 'all' | 'custom'

export const PERIODS: { key: Exclude<PeriodKey, 'custom'>; label: Record<'en' | 'el' | 'ru', string> }[] = [
  { key: 'this_month', label: { en: 'This month', el: 'Αυτός ο μήνας', ru: 'Этот месяц' } },
  { key: 'last_month', label: { en: 'Last month', el: 'Προηγούμενος μήνας', ru: 'Прошлый месяц' } },
  { key: 'this_year', label: { en: 'This year', el: 'Φέτος', ru: 'Этот год' } },
  { key: 'all', label: { en: 'All time', el: 'Από την αρχή', ru: 'За всё время' } },
]

const DAY = /^\d{4}-\d{2}-\d{2}$/
const iso = (d: Date) => d.toISOString().slice(0, 10)

/** Today in Cyprus, as a UTC date at midnight. */
function today() {
  const s = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Nicosia' }).format(new Date())
  return new Date(`${s}T00:00:00Z`)
}

export function readPeriod(sp: Record<string, string | string[] | undefined>): { key: PeriodKey; from: string | null; to: string | null } {
  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '')
  const from = DAY.test(str('from')) ? str('from') : null
  const to = DAY.test(str('to')) ? str('to') : null
  if (from || to) return { key: 'custom', from, to }
  const t = today()
  const y = t.getUTCFullYear()
  const m = t.getUTCMonth()
  switch (str('period')) {
    case 'last_month':
      return { key: 'last_month', from: iso(new Date(Date.UTC(y, m - 1, 1))), to: iso(new Date(Date.UTC(y, m, 0))) }
    case 'this_year':
      return { key: 'this_year', from: `${y}-01-01`, to: iso(t) }
    case 'all':
      return { key: 'all', from: null, to: null }
    default:
      return { key: 'this_month', from: iso(new Date(Date.UTC(y, m, 1))), to: iso(t) }
  }
}
