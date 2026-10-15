'use client'

/* Opens the Customer Service panel from anywhere — the help page, the
   homepage, a sold-out product. The panel itself lives in the layout. */

export function OpenChatButton({ label, className, message }: { label: string; className?: string; message?: string }) {
  return (
    <button
      type="button"
      className={className}
      onClick={() => window.dispatchEvent(new CustomEvent('support:open', { detail: { message } }))}
    >
      {label}
    </button>
  )
}
