'use client'

/* Six boxes for a six-digit code.
 *
 *   typing        a digit fills the box and moves to the next
 *   backspace     clears the box; on an empty box, goes back and clears that
 *   arrows        move between boxes; Home/End jump to the ends
 *   paste         a code pasted anywhere fills all six (spaces and dashes ignored)
 *   autofill      iOS/Android "from Messages/Mail" arrives as one value in the
 *                 first box (autocomplete="one-time-code") and is spread out
 *
 * The value lives in the parent as one string; the boxes are just a view of
 * it. When the sixth digit lands, onComplete fires so the form can submit. */

import { useRef } from 'react'

const LENGTH = 6

export function OtpInput({
  value,
  onChange,
  onComplete,
  label,
  digitLabel,
  error,
  disabled,
  autoFocus,
}: {
  value: string
  onChange: (code: string) => void
  onComplete?: (code: string) => void
  label: string
  /** "Digit {n} of 6" — n is filled in. */
  digitLabel: (n: number) => string
  error?: string | null
  disabled?: boolean
  autoFocus?: boolean
}) {
  const boxes = useRef<(HTMLInputElement | null)[]>([])
  const digits = Array.from({ length: LENGTH }, (_, i) => value[i] ?? '')

  const focus = (i: number) => {
    const el = boxes.current[Math.max(0, Math.min(LENGTH - 1, i))]
    el?.focus()
    el?.select()
  }

  function commit(next: string) {
    const clean = next.replace(/\D/g, '').slice(0, LENGTH)
    onChange(clean)
    if (clean.length === LENGTH) onComplete?.(clean)
  }

  /* Put `incoming` digits in starting at box i. */
  function fill(i: number, incoming: string) {
    const d = incoming.replace(/\D/g, '')
    if (!d) return
    /* A whole code (paste, SMS/Mail autofill) replaces everything. */
    if (d.length >= LENGTH) {
      commit(d.slice(0, LENGTH))
      focus(LENGTH - 1)
      return
    }
    const arr = digits.slice()
    for (let k = 0; k < d.length && i + k < LENGTH; k++) arr[i + k] = d[k]
    /* No gaps: a digit typed into box 4 while box 2 is empty lands in box 2. */
    const joined = arr.join('')
    commit(joined)
    focus(Math.min(joined.length, LENGTH - 1))
  }

  function onKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace') {
      e.preventDefault()
      if (digits[i]) {
        commit(value.slice(0, i) + value.slice(i + 1))
        focus(i)
      } else if (i > 0) {
        commit(value.slice(0, i - 1) + value.slice(i))
        focus(i - 1)
      }
    } else if (e.key === 'Delete') {
      e.preventDefault()
      commit(value.slice(0, i) + value.slice(i + 1))
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      focus(i - 1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      focus(i + 1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focus(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focus(LENGTH - 1)
    }
  }

  return (
    <fieldset disabled={disabled}>
      <legend className="label block text-muted">{label}</legend>
      <div className="mt-2 flex gap-2 sm:gap-3" onPaste={(e) => {
        e.preventDefault()
        const target = boxes.current.indexOf(document.activeElement as HTMLInputElement)
        fill(target < 0 ? 0 : target, e.clipboardData.getData('text'))
      }}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              boxes.current[i] = el
            }}
            value={d}
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? 'one-time-code' : 'off'}
            /* Room for a whole autofilled code; fill() keeps one digit per box. */
            maxLength={LENGTH}
            autoFocus={autoFocus && i === 0}
            aria-label={digitLabel(i + 1)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'otp-error' : undefined}
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => onKeyDown(i, e)}
            onChange={(e) => {
              const raw = e.target.value
              if (!raw) return
              /* The box already held a digit: the new one is what was typed. */
              fill(i, raw.length === 2 && d ? raw.replace(d, '') || raw.slice(-1) : raw)
            }}
            className={`h-14 w-full min-w-0 border text-center text-2xl font-medium tabular-nums outline-none transition-colors focus:border-accent disabled:opacity-50 ${
              error ? 'border-sale' : d ? 'border-ink' : 'border-line'
            }`}
          />
        ))}
      </div>
      {error && (
        <p id="otp-error" role="alert" className="mt-1.5 text-xs text-sale">
          {error}
        </p>
      )}
    </fieldset>
  )
}
