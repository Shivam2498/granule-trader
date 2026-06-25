import { describe, it, expect } from 'vitest'
import { formatINR, formatAddress } from '../../src/renderer/lib/format'
describe('formatINR', () => {
  it('uses Indian grouping with two decimals', () => { expect(formatINR(1180)).toBe('₹1,180.00') })
  it('groups lakhs', () => { expect(formatINR(125000.5)).toBe('₹1,25,000.50') })
})

describe('formatAddress', () => {
  it('joins all four with a dash before pincode', () => {
    expect(formatAddress({ address: '1 Estate Rd', city: 'Surat', state: 'Gujarat', pincode: '395003' }))
      .toBe('1 Estate Rd, Surat, Gujarat — 395003')
  })
  it('omits the dash when pincode is missing', () => {
    expect(formatAddress({ address: '1 Estate Rd', city: 'Surat', state: 'Gujarat' }))
      .toBe('1 Estate Rd, Surat, Gujarat')
  })
  it('skips empty parts', () => {
    expect(formatAddress({ city: 'Surat', state: 'Gujarat' })).toBe('Surat, Gujarat')
  })
  it('returns just the pincode when it is the only field', () => {
    expect(formatAddress({ pincode: '395003' })).toBe('395003')
  })
  it('returns empty string when nothing is provided', () => {
    expect(formatAddress({})).toBe('')
  })
})
