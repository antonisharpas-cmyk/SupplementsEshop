'use client'

/* A language switch that stays on the same page: /en/products/whey becomes
   /el/products/whey, not the Greek home page. */

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LOCALES } from '@/config/brand'

export function LocaleLink({ code, ...rest }: { code: string } & Omit<React.ComponentProps<typeof Link>, 'href'>) {
  const path = usePathname() ?? '/'
  const parts = path.split('/')
  const href = (LOCALES as readonly string[]).includes(parts[1] ?? '') ? ['', code, ...parts.slice(2)].join('/') : `/${code}`
  return <Link href={href} {...rest} />
}
