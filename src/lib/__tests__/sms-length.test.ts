import { describe, expect, it } from 'vitest'
import { smsLength } from '../sms-length'

describe('smsLength', () => {
  it('counts plain English as GSM, 160 to one SMS', () => {
    expect(smsLength('a'.repeat(160))).toMatchObject({ encoding: 'GSM', segments: 1 })
    expect(smsLength('a'.repeat(161))).toMatchObject({ encoding: 'GSM', segments: 2 })
    expect(smsLength('a'.repeat(306))).toMatchObject({ segments: 2 })
    expect(smsLength('a'.repeat(307))).toMatchObject({ segments: 3 })
  })
  it('counts € and brackets as two characters', () => {
    expect(smsLength('€').characters).toBe(2)
    expect(smsLength('[x]').characters).toBe(5)
  })
  it('switches Greek and Cyrillic to Unicode, 70 to one SMS', () => {
    expect(smsLength('Προσφορά'.padEnd(70, 'α'))).toMatchObject({ encoding: 'Unicode', segments: 1 })
    expect(smsLength('Скидка'.padEnd(71, 'а'))).toMatchObject({ encoding: 'Unicode', segments: 2 })
  })
  it('keeps Greek capitals that GSM has in GSM', () => {
    expect(smsLength('ΔΩΣ').encoding).toBe('GSM')
  })
})
