/* UI copy: every key present in every locale, and counted messages using the
   right plural form. "1 προϊόντα" and "2 товаров" are the bugs this catches. */

import { describe, expect, it } from 'vitest'
import { getTranslator, messages, type MessageKey } from '../messages'

const LOCALES = ['en', 'el', 'ru'] as const

describe('dictionaries', () => {
  it('has the same keys in every locale', () => {
    const english = Object.keys(messages.en).sort()
    for (const locale of LOCALES) {
      expect(Object.keys(messages[locale]).sort(), `locale ${locale}`).toEqual(english)
    }
  })

  it('leaves no message empty', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        expect(String(value).trim(), `${locale}.${key}`).not.toBe('')
      }
    }
  })

  it('declares an "other" form wherever it declares plural forms', () => {
    for (const locale of LOCALES) {
      for (const [key, value] of Object.entries(messages[locale])) {
        const template = String(value)
        if (!template.includes('|') || !/^[a-z]+:/.test(template)) continue
        const forms = template.split('|').map((p) => p.slice(0, p.indexOf(':')))
        expect(forms, `${locale}.${key}`).toContain('other')
      }
    }
  })

  it('does not leave a {placeholder} in a translation that English does not have', () => {
    const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
    for (const locale of LOCALES) {
      for (const key of Object.keys(messages.en) as MessageKey[]) {
        const theirs = new Set(slots(String(messages[locale][key])))
        const ours = new Set(slots(String(messages.en[key])))
        for (const slot of theirs) {
          expect([...ours], `${locale}.${key} uses {${slot}}`).toContain(slot)
        }
      }
    }
  })
})

describe('plural selection', () => {
  it('uses the singular for one in English', () => {
    const t = getTranslator('en')
    expect(t('list.results', { n: 1 })).toBe('1 product')
    expect(t('list.results', { n: 6 })).toBe('6 products')
    expect(t('list.results', { n: 0 })).toBe('0 products')
  })

  it('uses the singular for one in Greek', () => {
    const t = getTranslator('el')
    /* The bug on the Greek listing page: "1 προϊόντα". */
    expect(t('list.results', { n: 1 })).toBe('1 προϊόν')
    expect(t('list.results', { n: 4 })).toBe('4 προϊόντα')
  })

  it('handles the Russian one/few/many split', () => {
    const t = getTranslator('ru')
    expect(t('list.results', { n: 1 })).toBe('1 товар')
    expect(t('list.results', { n: 2 })).toBe('2 товара')
    expect(t('list.results', { n: 5 })).toBe('5 товаров')
    expect(t('list.results', { n: 21 })).toBe('21 товар')
    expect(t('list.results', { n: 22 })).toBe('22 товара')
    expect(t('list.results', { n: 11 })).toBe('11 товаров')
  })

  it('pluralises the bag summary too', () => {
    expect(getTranslator('en')('cart.itemCount', { n: 1 })).toBe('1 item')
    expect(getTranslator('en')('cart.itemCount', { n: 3 })).toBe('3 items')
    expect(getTranslator('ru')('cart.itemCount', { n: 3 })).toBe('3 товара')
  })

  it('leaves ordinary messages with a pipe or colon in them alone', () => {
    const t = getTranslator('en')
    /* Not plural syntax: no leading "form:" marker. */
    expect(t('list.sort.priceAsc')).toBe('Price: low to high')
  })
})

describe('substitution', () => {
  it('fills placeholders', () => {
    const t = getTranslator('en')
    expect(t('list.maxPrice', { price: '€50.00' })).toBe('Up to €50.00')
  })

  it('falls back to English rather than showing a key', () => {
    const t = getTranslator('el')
    expect(t('cart.checkout')).not.toBe('cart.checkout')
  })
})
