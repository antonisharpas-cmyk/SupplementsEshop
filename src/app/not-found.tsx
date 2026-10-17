import Link from 'next/link'
import './globals.css'

export default function NotFound() {
  return (
    <html lang="en">
      <body className="grid min-h-screen place-items-center bg-paper px-6 text-center text-ink">
        <div>
          <p className="label text-muted">404</p>
          <h1 className="mt-3 text-2xl font-semibold tracking-tight">
            We could not find that page.
          </h1>
          <Link
            href="/"
            className="btn btn-primary mt-6"
          >
            Back to the shop
          </Link>
        </div>
      </body>
    </html>
  )
}
