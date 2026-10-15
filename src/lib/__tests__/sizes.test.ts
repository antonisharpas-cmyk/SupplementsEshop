/* Size ordering. Alphabetical is wrong for sizes in every language, and it is
   the ordering a database gives you by default, so this is worth pinning. */

import { describe, expect, it } from 'vitest'
import { compareSizes, sortBySize, sortSizes } from '../sizes'

describe('sortSizes', () => {
  it('puts letter sizes in the order a customer expects', () => {
    /* Exactly what Postgres hands back: alphabetical. */
    const fromTheDatabase = ['L', 'M', 'One size', 'S', 'XL', 'XS', 'XXL']
    expect(sortSizes(fromTheDatabase)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'XXL', 'One size'])
  })

  it('sorts numeric sizes numerically, not as strings', () => {
    expect(sortSizes(['32', '8', '10', '28', '30'])).toEqual(['8', '10', '28', '30', '32'])
  })

  it('keeps numeric and letter sizes in separate blocks', () => {
    const sorted = sortSizes(['M', '32', 'XS', '30'])
    expect(sorted).toEqual(['30', '32', 'XS', 'M'])
  })

  it('accepts 2XL and 3XL as well as XXL and XXXL', () => {
    expect(sortSizes(['3XL', 'M', '2XL', 'L'])).toEqual(['M', 'L', '2XL', '3XL'])
  })

  it('is case-insensitive', () => {
    expect(sortSizes(['xl', 's', 'm'])).toEqual(['s', 'm', 'xl'])
  })

  it('handles combined sizes like S/M', () => {
    expect(sortSizes(['M/L', 'XS/S', 'S/M'])).toEqual(['XS/S', 'S/M', 'M/L'])
  })

  it('always puts a one-size label last, however it is spelled', () => {
    expect(sortSizes(['One size', 'XL', 'S']).at(-1)).toBe('One size')
    expect(sortSizes(['Free Size', 'XL', 'S']).at(-1)).toBe('Free Size')
    expect(sortSizes(['OSFA', 'XL', 'S']).at(-1)).toBe('OSFA')
  })

  it('does not lose an unrecognised size', () => {
    const sorted = sortSizes(['Tall', 'M', 'S'])
    expect(sorted).toHaveLength(3)
    expect(sorted).toContain('Tall')
    /* Unknowns sit after the graded run so they cannot break it up. */
    expect(sorted.slice(0, 2)).toEqual(['S', 'M'])
  })

  it('does not mutate its input', () => {
    const input = ['XL', 'S']
    sortSizes(input)
    expect(input).toEqual(['XL', 'S'])
  })

  it('is a consistent comparator', () => {
    expect(compareSizes('S', 'M')).toBeLessThan(0)
    expect(compareSizes('M', 'S')).toBeGreaterThan(0)
    expect(compareSizes('M', 'M')).toBe(0)
  })
})

describe('sortBySize', () => {
  it('orders rows without discarding the rest of the row', () => {
    const facets = [
      { size: 'XL', count: 2 },
      { size: 'S', count: 9 },
      { size: 'M', count: 4 },
    ]
    expect(sortBySize(facets, (f) => f.size)).toEqual([
      { size: 'S', count: 9 },
      { size: 'M', count: 4 },
      { size: 'XL', count: 2 },
    ])
  })
})
