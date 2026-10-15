import Link from 'next/link'

export default function NotFound() {
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center px-6 text-center">
        <div>
          <p className="label text-muted">404</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            We could not find that page.
          </h1>
          <Link
            href="/"
            className="mt-6 inline-block border border-ink px-6 py-3 label hover:bg-accent hover:text-paper"
          >
            Back to the shop
          </Link>
        </div>
      </body>
    </html>
  )
}
