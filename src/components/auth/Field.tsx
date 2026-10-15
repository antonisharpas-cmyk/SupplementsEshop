'use client'

/* Form primitives shared by sign-in and register.
 *
 * Every field is labelled (not placeholder-only — a placeholder disappears the
 * moment you type, which is exactly when people need to check what they were
 * asked for), and every error is tied to its input with aria-describedby so a
 * screen reader announces it. */

import type { InputHTMLAttributes, ReactNode } from 'react'

export function Field({
  label,
  name,
  error,
  hint,
  ...props
}: {
  label: string
  name: string
  error?: string | null
  hint?: ReactNode
} & InputHTMLAttributes<HTMLInputElement>) {
  const errorId = `${name}-error`
  const hintId = `${name}-hint`

  return (
    <div>
      <label htmlFor={name} className="label block text-muted">
        {label}
      </label>
      <input
        id={name}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : hint ? hintId : undefined}
        className={`mt-2 w-full border px-3.5 py-3 text-[15px] outline-none transition-colors focus:border-accent ${
          error ? 'border-sale' : 'border-line'
        }`}
        {...props}
      />
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

/** A failure that belongs to the whole form rather than one field. */
export function FormError({ children }: { children: ReactNode }) {
  if (!children) return null
  return (
    <p role="alert" className="border border-sale/40 bg-sale/5 px-4 py-3 text-sm text-sale">
      {children}
    </p>
  )
}

export function AuthCard({ title, sub, children }: { title: string; sub?: ReactNode; children: ReactNode }) {
  return (
    <div className="container-x flex justify-center py-14">
      <div className="w-full max-w-md">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-2 text-sm text-muted">{sub}</p>}
        <div className="mt-8">{children}</div>
      </div>
    </div>
  )
}
