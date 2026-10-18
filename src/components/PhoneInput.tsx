'use client'

/* A phone number as two parts: the country code (Cyprus and Greece first,
   then every other country by name) and the number itself.

   The value going in and out is one string, "+357 99123456", the same shape
   the server already normalises, so the forms around it do not change. */

import { useMemo, useState } from 'react'
import type { Locale } from '@/config/brand'

type Country = { iso: string; code: string }

/* Cyprus and Greece always lead; the rest are sorted by name in the
   visitor's language. */
const FIRST: Country[] = [
  { iso: 'CY', code: '357' },
  { iso: 'GR', code: '30' },
]
const OTHERS: Country[] = [
  { iso: 'GB', code: '44' }, { iso: 'RU', code: '7' }, { iso: 'UA', code: '380' }, { iso: 'BG', code: '359' },
  { iso: 'RO', code: '40' }, { iso: 'DE', code: '49' }, { iso: 'FR', code: '33' }, { iso: 'IT', code: '39' },
  { iso: 'ES', code: '34' }, { iso: 'PT', code: '351' }, { iso: 'NL', code: '31' }, { iso: 'BE', code: '32' },
  { iso: 'LU', code: '352' }, { iso: 'IE', code: '353' }, { iso: 'AT', code: '43' }, { iso: 'CH', code: '41' },
  { iso: 'PL', code: '48' }, { iso: 'CZ', code: '420' }, { iso: 'SK', code: '421' }, { iso: 'HU', code: '36' },
  { iso: 'SI', code: '386' }, { iso: 'HR', code: '385' }, { iso: 'RS', code: '381' }, { iso: 'MT', code: '356' },
  { iso: 'SE', code: '46' }, { iso: 'NO', code: '47' }, { iso: 'DK', code: '45' }, { iso: 'FI', code: '358' },
  { iso: 'EE', code: '372' }, { iso: 'LV', code: '371' }, { iso: 'LT', code: '370' }, { iso: 'BY', code: '375' },
  { iso: 'GE', code: '995' }, { iso: 'AM', code: '374' }, { iso: 'IL', code: '972' }, { iso: 'LB', code: '961' },
  { iso: 'JO', code: '962' }, { iso: 'SY', code: '963' }, { iso: 'EG', code: '20' }, { iso: 'AE', code: '971' },
  { iso: 'SA', code: '966' }, { iso: 'IN', code: '91' }, { iso: 'LK', code: '94' }, { iso: 'NP', code: '977' },
  { iso: 'PH', code: '63' }, { iso: 'VN', code: '84' }, { iso: 'CN', code: '86' }, { iso: 'US', code: '1' },
  { iso: 'AU', code: '61' }, { iso: 'ZA', code: '27' },
]
const ALL = [...FIRST, ...OTHERS]

function flag(iso: string) {
  return String.fromCodePoint(...[...iso].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65))
}

/** Split "+357 99123456" (or "0035799…") into a known country and the rest. */
function split(value: string): { iso: string; number: string } {
  const v = value.trim()
  const digits = v.replace(/\D/g, '').replace(/^00/, '')
  if (v.startsWith('+') || v.startsWith('00')) {
    /* Longest code first, so +357 is not read as +35… */
    const match = [...ALL].sort((a, b) => b.code.length - a.code.length).find((c) => digits.startsWith(c.code))
    if (match) return { iso: match.iso, number: digits.slice(match.code.length) }
  }
  return { iso: 'CY', number: v.replace(/[^\d ]/g, '') }
}

export function PhoneInput({
  locale,
  label,
  name,
  value,
  onChange,
  error,
  required,
  className = '',
}: {
  locale: Locale
  label: string
  name: string
  value: string
  onChange: (value: string) => void
  error?: string | null
  required?: boolean
  /** Extra classes for the two boxes, to match the form around it. */
  className?: string
}) {
  const initial = useMemo(() => split(value), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [iso, setIso] = useState(initial.iso)
  const [number, setNumber] = useState(initial.number)

  const names = useMemo(() => {
    try {
      return new Intl.DisplayNames([locale], { type: 'region' })
    } catch {
      return null
    }
  }, [locale])
  const nameOf = (c: Country) => names?.of(c.iso) ?? c.iso
  const others = useMemo(
    () => [...OTHERS].sort((a, b) => nameOf(a).localeCompare(nameOf(b), locale)),
    [names, locale], // eslint-disable-line react-hooks/exhaustive-deps
  )

  const codeOf = (i: string) => ALL.find((c) => c.iso === i)?.code ?? '357'
  const emit = (i: string, n: string) => {
    /* A leading 0 is the national trunk prefix (UK 07…), never dialled after
       the country code. */
    const clean = n.replace(/\D/g, '').replace(/^0+/, '')
    onChange(clean ? `+${codeOf(i)} ${clean}` : '')
  }

  const errorId = `${name}-error`
  const box = `border bg-paper px-3.5 py-3 text-[15px] outline-none transition-colors focus:border-accent ${error ? 'border-sale' : 'border-line'} ${className}`

  return (
    <div>
      <label htmlFor={name} className="label block text-muted">
        {label}
      </label>
      <div className="mt-2 flex gap-2">
        {/* The native list opens on tap (best on phones); the closed box shows
            just the flag and code, so the number field keeps its width. */}
        <div className={`${box} relative flex w-[7.75rem] shrink-0 items-center justify-between gap-1 focus-within:border-accent`}>
          <span aria-hidden className="truncate tabular-nums">
            {flag(iso)} +{codeOf(iso)}
          </span>
          <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-muted" fill="currentColor">
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
          </svg>
          <select
            aria-label={`${label}: country code`}
            value={iso}
            onChange={(e) => {
              setIso(e.target.value)
              emit(e.target.value, number)
            }}
            className="absolute inset-0 h-full w-full cursor-pointer bg-paper text-white opacity-0"
          >
            {FIRST.map((c) => (
              <option key={c.iso} value={c.iso}>
                {flag(c.iso)} {nameOf(c)} (+{c.code})
              </option>
            ))}
            <option disabled>──────────</option>
            {others.map((c) => (
              <option key={c.iso} value={c.iso}>
                {flag(c.iso)} {nameOf(c)} (+{c.code})
              </option>
            ))}
          </select>
        </div>
        <input
          id={name}
          name={name}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          required={required}
          value={number}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          onChange={(e) => {
            const raw = e.target.value
            /* A full number pasted with its own code picks the country too. */
            if (/^\s*(\+|00)/.test(raw)) {
              const s = split(raw)
              setIso(s.iso)
              setNumber(s.number)
              emit(s.iso, s.number)
              return
            }
            const n = raw.replace(/[^\d ]/g, '')
            setNumber(n)
            emit(iso, n)
          }}
          className={`${box} min-w-0 flex-1`}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-sale">
          {error}
        </p>
      )}
    </div>
  )
}
