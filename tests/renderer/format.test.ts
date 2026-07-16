import { describe, it, expect } from 'vitest'
import { formatINR, formatAddress, formatDate } from '../../src/renderer/lib/format'
describe('formatINR', () => {
  it('uses Indian grouping with two decimals', () => { expect(formatINR(1180)).toBe('₹1,180.00') })
  it('groups lakhs', () => { expect(formatINR(125000.5)).toBe('₹1,25,000.50') })
  it('places the minus sign before the rupee symbol for negatives', () => {
    expect(formatINR(-1180)).toBe('-₹1,180.00')
  })
  it('renders a non-finite input as zero rupees', () => {
    expect(formatINR(NaN)).toBe('₹0.00')
  })
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

describe('formatDate', () => {
  it('converts ISO to DD/MM/YYYY', () => {
    expect(formatDate('2026-04-16')).toBe('16/04/2026')
    expect(formatDate('2025-12-01')).toBe('01/12/2025')
  })
  it('returns empty for empty, null or undefined', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })
  it('passes through anything that is not an ISO date', () => {
    expect(formatDate('16/04/2026')).toBe('16/04/2026')   // already formatted
    expect(formatDate('not a date')).toBe('not a date')
  })
})
