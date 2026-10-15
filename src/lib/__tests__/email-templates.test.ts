/* The template system itself — pure, no database: every built-in email is
   complete, variables are filled safely, nothing typed can become HTML or
   code, and a language with no words falls back to English. */

import { describe, expect, it } from 'vitest'
import {
  delayLabel,
  render,
  sampleVars,
  templateDef,
  TEMPLATES,
  unknownVariables,
  VARIABLES,
  wordsFor,
} from '../email-templates'

const SITE = 'https://shop.example'

describe('the built-in emails', () => {
  it('every email has words in English, Greek and Russian (staff emails: English)', () => {
    for (const def of TEMPLATES) {
      expect(def.words.en.subject, def.key).toBeTruthy()
      expect(def.words.en.body, def.key).toBeTruthy()
      if (!def.internal) {
        expect(def.words.el.subject, `${def.key} el`).toBeTruthy()
        expect(def.words.ru.body, `${def.key} ru`).toBeTruthy()
      }
    }
  })

  it('uses only variables it declares, and every declared one exists', () => {
    for (const def of TEMPLATES) {
      for (const v of def.variables) expect(VARIABLES[v], `${def.key}: ${v}`).toBeDefined()
      for (const loc of ['en', 'el', 'ru'] as const) {
        const w = def.words[loc]
        expect(unknownVariables(`${w.subject} ${w.body} ${w.cta ?? ''}`, def.variables), `${def.key} ${loc}`).toEqual([])
      }
    }
  })

  it('marks the required emails required, and the optional ones optional', () => {
    const required = TEMPLATES.filter((t) => t.required).map((t) => t.key)
    for (const k of ['auth_verification', 'auth_password_reset', 'order_received', 'order_shipped', 'support_transcript'] as const) {
      expect(required).toContain(k)
    }
    for (const k of ['welcome', 'abandoned_bag', 'abandoned_bag_followup', 'back_in_stock', 'review_request'] as const) {
      expect(required).not.toContain(k)
    }
  })

  it('files the abandoned bag under marketing, welcome under lifecycle, orders under essential', () => {
    expect(templateDef('abandoned_bag').category).toBe('marketing')
    expect(templateDef('welcome').category).toBe('lifecycle')
    expect(templateDef('order_shipped').category).toBe('essential')
  })

  it('waits about four hours before the bag reminder, a day for the follow-up (off by default)', () => {
    expect(templateDef('abandoned_bag').timing?.minutes).toBe(240)
    expect(templateDef('abandoned_bag_followup').timing?.minutes).toBe(1440)
    expect(templateDef('abandoned_bag_followup').defaultEnabled).toBe(false)
    expect(templateDef('review_request').defaultEnabled).toBe(false)
    expect(delayLabel(240)).toBe('4 hours')
    expect(delayLabel(1440)).toBe('1 day')
  })

  it('says the right things', () => {
    expect(templateDef('abandoned_bag').words.en.subject).toBe('You left something behind')
    expect(templateDef('abandoned_bag').words.en.cta).toBe('Return to my bag')
    expect(templateDef('abandoned_bag_followup').words.en.subject).toBe('Still thinking about it?')
    expect(templateDef('welcome').words.en.subject).toBe('Welcome to AIONIX')
    expect(templateDef('welcome').words.en.cta).toBe('Shop now')
    expect(templateDef('back_in_stock').words.en.subject).toMatch(/It’s back/)
    expect(templateDef('review_request').words.en.subject).toBe('How did you like your AIONIX order?')
  })

  it('renders every email with its sample values in every language', () => {
    for (const def of TEMPLATES) {
      for (const loc of ['en', 'el', 'ru'] as const) {
        const r = render(def, wordsFor(def, loc), sampleVars(def), { siteBase: SITE })
        expect(r.subject, `${def.key} ${loc}`).not.toMatch(/\{\{|\}\}/)
        expect(r.text, `${def.key} ${loc}`).not.toMatch(/\{\{|\}\}/)
        expect(r.html).toContain('<!doctype html>')
      }
    }
  })
})

describe('variables', () => {
  const def = templateDef('order_shipped')

  it('fills them in, escaped for HTML', () => {
    const received = templateDef('order_received')
    const r = render(received, wordsFor(received, 'en'), { customer_name: '<b>Maria</b>', order_number: 'SF-1', order_url: '/en/account' }, { siteBase: SITE })
    expect(r.html).toContain('&lt;b&gt;Maria&lt;/b&gt;')
    expect(r.html).not.toContain('<b>Maria</b>')
    expect(r.text).toContain('<b>Maria</b>') /* the text part is text */
  })

  it('leaves out a paragraph whose variable is empty — no "Tracking number:" without one', () => {
    const w = wordsFor(def, 'en')
    const without = render(def, w, { customer_name: 'Maria', order_number: 'SF-1', order_url: '/x' }, { siteBase: SITE })
    const withIt = render(def, w, { customer_name: 'Maria', order_number: 'SF-1', order_url: '/x', tracking_number: 'CY123' }, { siteBase: SITE })
    expect(without.text).not.toMatch(/tracking/i)
    expect(withIt.text).toContain('CY123')
  })

  it('ignores a variable the email does not offer', () => {
    const w = { subject: 'Hi {{customer_name}}', body: 'Code {{code}} for {{customer_name}}' }
    const r = render(def, w, { customer_name: 'Maria', code: '123456' }, { siteBase: SITE })
    /* order_shipped does not offer {{code}}: that paragraph cannot be filled, so it goes. */
    expect(r.text).not.toContain('123456')
    expect(unknownVariables(w.body, def.variables)).toEqual(['code'])
  })

  it('treats typed HTML and template-looking code as plain text', () => {
    const w = {
      subject: '<script>x</script>',
      body: '<a href="javascript:alert(1)">click</a>\n\n${process.env.JWT_SECRET} {{constructor.constructor}} <%= 1 %>',
    }
    const r = render(def, w, { customer_name: 'Maria' }, { siteBase: SITE })
    expect(r.html).not.toContain('<a href="javascript')
    expect(r.html).toContain('&lt;a href=&quot;javascript:alert(1)&quot;&gt;')
    expect(r.html).toContain('${process.env.JWT_SECRET}')
    expect(r.text).not.toContain(process.env.JWT_SECRET ?? 'never-set-in-tests')
  })

  it('draws the bag as rows with image, name, quantity and price', () => {
    const bag = templateDef('abandoned_bag')
    const r = render(bag, wordsFor(bag, 'en'), sampleVars(bag), { siteBase: SITE })
    expect(r.html).toContain(`${SITE}/products/`)
    expect(r.html).toContain('Whey Protein Isolate')
    expect(r.html).toContain('× 1')
    expect(r.html).toContain('€64.90')
    expect(r.html).toContain('Return to my bag')
    expect(r.text).toContain('Return to my bag: https://aionix.example/en/cart')
  })
})

describe('language', () => {
  const def = templateDef('welcome')

  it('uses the customer’s language', () => {
    expect(wordsFor(def, 'el').subject).toBe(def.words.el.subject)
    expect(wordsFor(def, 'ru').subject).toBe(def.words.ru.subject)
  })

  it('uses the owner’s words where they wrote some, the built-in ones elsewhere', () => {
    const w = wordsFor(def, 'el', { el: { subject: 'Καλώς ήρθες!' } })
    expect(w.subject).toBe('Καλώς ήρθες!')
    expect(w.body).toBe(def.words.el.body)
  })

  it('falls back to English for a language with no words', () => {
    const staff = templateDef('support_new')
    expect(wordsFor(staff, 'ru').subject).toBe(staff.words.en.subject)
  })
})
