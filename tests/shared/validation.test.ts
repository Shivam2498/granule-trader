import { describe, it, expect } from 'vitest'
import { isGstin, isPan, isMobile, isPincode, deriveInvoicePrefix } from '../../src/shared/validation'

describe('format validators', () => {
  it('accepts a valid GSTIN and rejects bad ones', () => {
    expect(isGstin('24ABCDE1234F1Z5')).toBe(true)
    expect(isGstin('24abcde1234f1z5')).toBe(false)   // lowercase
    expect(isGstin('24ABCDE1234F1Z')).toBe(false)    // 14 chars
  })
  it('validates PAN', () => {
    expect(isPan('ABCDE1234F')).toBe(true)
    expect(isPan('ABCDE1234')).toBe(false)
  })
  it('validates 10-digit mobile and 6-digit pincode', () => {
    expect(isMobile('9876543210')).toBe(true)
    expect(isMobile('98765')).toBe(false)
    expect(isPincode('395003')).toBe(true)
    expect(isPincode('39500')).toBe(false)
  })
})

describe('deriveInvoicePrefix', () => {
  it('takes initials of significant words', () => {
    expect(deriveInvoicePrefix('Ramaxton Plastocrafts')).toBe('RP')
    expect(deriveInvoicePrefix('Shree Ram Traders')).toBe('SRT')
    expect(deriveInvoicePrefix('Ram and Sons & Co')).toBe('RSC')   // skip and/&
  })
  it('falls back to first two letters for a single word', () => {
    expect(deriveInvoicePrefix('Ramaxton')).toBe('RA')
  })
  it('returns empty for empty input', () => {
    expect(deriveInvoicePrefix('   ')).toBe('')
  })
})
