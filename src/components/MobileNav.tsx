'use client'

import { useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import type { Locale } from '@/config/brand'
import { LOCALES, LOCALE_LABELS } from '@/config/brand'
import type { CategoryNode } from '@/lib/catalog'
import { tField as tr } from '@/i18n/field'
import { getTranslator } from '@/i18n/messages'

/* Section 37: the mobile experience matters most. A drawer rather than a
   dropdown, because two levels of category do not fit in a dropdown on a
   phone. */
export function MobileNav({ locale, categories }: { locale: Locale; categories: CategoryNode[] }) {
  const [open, setOpen] = useState(false)
  const base = `/${locale}`
  const t = getTranslator(locale)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('nav.menu')}
        aria-expanded={open}
        className="-mr-2 grid h-10 w-10 place-items-center lg:hidden"
      >
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {open &&
        createPortal(
          <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={t('nav.menu')}>
            <button className="absolute inset-0 bg-black/40" onClick={() => setOpen(false)} aria-label="Close" />
            <div className="absolute inset-y-0 right-0 flex w-[86%] max-w-sm flex-col overflow-y-auto bg-paper">
              <div className="flex items-center justify-between border-b border-line px-5 py-4">
                <span className="label">Menu</span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="p-1">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                    <path d="M6 6l12 12M18 6L6 18" />
                  </svg>
                </button>
              </div>

              <nav className="flex-1 px-5 py-4">
                {categories.map((root) => (
                  <div key={root.id} className="mb-6">
                    <Link
                      href={`${base}/${root.slug}`}
                      onClick={() => setOpen(false)}
                      className="block text-lg font-semibold tracking-tight"
                    >
                      {tr(root.name, locale)}
                    </Link>
                    <ul className="mt-2 space-y-1">
                      {root.children.map((child) => (
                        <li key={child.id}>
                          <Link
                            href={`${base}/${root.slug}/${child.slug}`}
                            onClick={() => setOpen(false)}
                            className="block py-1.5 text-sm text-ink-soft"
                          >
                            {tr(child.name, locale)}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
                <div className="mt-2 space-y-1 border-t border-line pt-4">
                  <Link href={`${base}/new`} onClick={() => setOpen(false)} className="block py-1.5 text-sm">
                    {t('new.title')}
                  </Link>
                  <Link href={`${base}/contact`} onClick={() => setOpen(false)} className="block py-1.5 text-sm">
                    {t('help.title')}
                  </Link>
                </div>
              </nav>

              <div className="border-t border-line px-5 py-4">
                <p className="label mb-2 text-muted">Language</p>
                <div className="flex gap-2">
                  {LOCALES.map((code) => (
                    <Link
                      key={code}
                      href={`/${code}`}
                      hrefLang={code}
                      onClick={() => setOpen(false)}
                      className={`border px-3 py-1.5 text-xs ${
                        code === locale ? 'border-ink' : 'border-line text-muted'
                      }`}
                    >
                      {LOCALE_LABELS[code]}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
