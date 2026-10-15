/* The address bar ⇄ filters: what a shared link means, and that reading a
   URL and writing it back gives the same URL. No database. */

import { describe, expect, it } from 'vitest'
import {
  activeFilterCount,
  clearFilters,
  colourKey,
  listingHref,
  parseListingParams,
  toggle,
  EMPTY_FILTERS,
} from '../listing-filters'

const parse = (qs: string) => parseListingParams(new URLSearchParams(qs))

describe('price in the URL', () => {
  it('reads whole euros', () => {
    expect(parse('minPrice=40&maxPrice=100')).toMatchObject({ minPrice: 40, maxPrice: 100 })
  })
  it('keeps a minimum on its own, and a maximum on its own', () => {
    expect(parse('minPrice=40')).toMatchObject({ minPrice: 40, maxPrice: undefined })
    expect(parse('maxPrice=90')).toMatchObject({ minPrice: undefined, maxPrice: 90 })
  })
  it('rounds outwards, so a €12.50 product is inside "12.50 – 20.20"', () => {
    expect(parse('minPrice=12.50&maxPrice=20.20')).toMatchObject({ minPrice: 12, maxPrice: 21 })
  })
  it('drops negative, empty and nonsense values', () => {
    expect(parse('minPrice=-5&maxPrice=abc')).toMatchObject({ minPrice: undefined, maxPrice: undefined })
    expect(parse('minPrice=&maxPrice=')).toMatchObject({ minPrice: undefined, maxPrice: undefined })
  })
  it('reads a minimum above the maximum the right way round', () => {
    expect(parse('minPrice=100&maxPrice=40')).toMatchObject({ minPrice: 40, maxPrice: 100 })
  })
  it('accepts zero and equal bounds', () => {
    expect(parse('minPrice=0&maxPrice=0')).toMatchObject({ minPrice: 0, maxPrice: 0 })
    expect(parse('minPrice=55&maxPrice=55')).toMatchObject({ minPrice: 55, maxPrice: 55 })
  })
})

describe('lists', () => {
  it('reads several sizes and colours, without duplicates', () => {
    const f = parse('size=M,L,M&colour=black,BLUE,black')
    expect(f.sizes).toEqual(['M', 'L'])
    expect(f.colours).toEqual(['black', 'blue'])
  })
  it('refuses anything that is not a plain key', () => {
    const f = parse(`colour=black,<script>,red';drop&category=hoodies,../etc`)
    expect(f.colours).toEqual(['black'])
    expect(f.categories).toEqual(['hoodies'])
  })
  it('understands the older parameter names', () => {
    expect(parse('sizes=S&onSale=1&inStockOnly=1')).toMatchObject({ sizes: ['S'], onSale: true, inStock: true })
  })
  it('ignores an unknown sort and a silly page', () => {
    expect(parse('sort=evil&page=-3')).toMatchObject({ sort: 'newest', page: 1 })
  })
})

describe('writing the URL', () => {
  it('produces the example link from the brief', () => {
    const f = { ...EMPTY_FILTERS, sizes: ['M'], colours: ['black'], minPrice: 40, maxPrice: 100 }
    expect(listingHref('/en/women', f)).toBe('/en/women?size=M&colour=black&minPrice=40&maxPrice=100')
  })
  it('round-trips: parse(write(x)) = x', () => {
    const f = {
      ...EMPTY_FILTERS,
      q: 'hood',
      department: 'men',
      categories: ['men/hoodies'],
      sizes: ['M', 'XL'],
      colours: ['washed-black'],
      minPrice: 20,
      onSale: true,
      inStock: true,
      sort: 'price-asc' as const,
      page: 2,
    }
    const href = listingHref('/en/new', f)
    expect(parse(href.split('?')[1])).toEqual(f)
  })
  it('leaves defaults out, so an unfiltered page has a clean address', () => {
    expect(listingHref('/en/men', EMPTY_FILTERS)).toBe('/en/men')
  })
})

describe('helpers', () => {
  it('counts every narrowing filter, but not sort or page', () => {
    expect(activeFilterCount({ ...EMPTY_FILTERS, sizes: ['M', 'L'], minPrice: 5, maxPrice: 9, inStock: true, sort: 'price-asc', page: 3 })).toBe(4)
  })
  it('"clear all" keeps the search words and the sort', () => {
    const cleared = clearFilters({ ...EMPTY_FILTERS, q: 'tee', sort: 'name-asc', sizes: ['M'], onSale: true, colours: ['red'] })
    expect(cleared).toEqual({ ...EMPTY_FILTERS, q: 'tee', sort: 'name-asc' })
  })
  it('colour keys match the database rule', () => {
    expect(colourKey('Washed Black')).toBe('washed-black')
    expect(colourKey('  Off-White ')).toBe('off-white')
  })
  it('toggles values', () => {
    expect(toggle(['a'], 'b')).toEqual(['a', 'b'])
    expect(toggle(['a', 'b'], 'a')).toEqual(['b'])
  })
})
