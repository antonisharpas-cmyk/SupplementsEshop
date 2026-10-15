'use client'

/* A password input with a show/hide button inside it.
 *
 * The button is a real <button type="button"> — reachable by keyboard, never
 * submits the form — with an aria-label that says what pressing it will do
 * and aria-pressed for its state. Showing the password does not change
 * autocomplete, so password managers keep working. */

import { useState, type InputHTMLAttributes, type ReactNode } from 'react'

export function PasswordField({
  label,
  name,
  error,
  hint,
  showLabel,
  hideLabel,
  ...props
}: {
  label: string
  name: string
  error?: string | null
  hint?: ReactNode
  showLabel: string
  hideLabel: string
} & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const [visible, setVisible] = useState(false)
  const errorId = `${name}-error`
  const hintId = `${name}-hint`

  return (
    <div>
      <label htmlFor={name} className="label block text-muted">
        {label}
      </label>
      <div className="relative mt-2">
        <input
          id={name}
          name={name}
          type={visible ? 'text' : 'password'}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : hint ? hintId : undefined}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={`w-full border py-3 pl-3.5 pr-12 text-[15px] outline-none transition-colors focus:border-accent ${
            error ? 'border-sale' : 'border-line'
          }`}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          aria-controls={name}
          className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-muted transition-colors hover:text-ink focus-visible:text-ink"
        >
          {visible ? <EyeOff /> : <Eye />}
        </button>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-sale">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

function Eye() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}

function EyeOff() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      <path d="M2.5 12S6 5.5 12 5.5c1.6 0 3 .45 4.2 1.1M21.5 12s-3.5 6.5-9.5 6.5c-1.6 0-3-.45-4.2-1.1" strokeLinejoin="round" />
      <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
      <path d="M4 4l16 16" strokeLinecap="round" />
    </svg>
  )
}
