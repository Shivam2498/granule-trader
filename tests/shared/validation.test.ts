import { describe, it, expect } from 'vitest'
import { isGstin, isPan, isMobile, isPincode, deriveInvoicePrefix, panFromGstin, isEmail } from '../../src/shared/validation'

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

describe('panFromGstin', () => {
  it('extracts the PAN (chars 3-12) from a valid GSTIN', () => {
    expect(panFromGstin('24CCGPC8555A1Z5')).toBe('CCGPC8555A')
    expect(isPan(panFromGstin('24CCGPC8555A1Z5'))).toBe(true)   // a valid GSTIN yields a valid PAN
  })
  it('uppercases and derives once 12+ chars are present', () => {
    expect(panFromGstin('24ccgpc8555a')).toBe('CCGPC8555A')
  })
  it('returns empty for a too-short GSTIN', () => {
    expect(panFromGstin('24CCGPC')).toBe('')
    expect(panFromGstin('')).toBe('')
  })
})

describe('isEmail', () => {
  it('accepts a normal address', () => {
    expect(isEmail('a@b.com')).toBe(true)
    expect(isEmail('ajay.arora_ent@gmail.co.in')).toBe(true)
  })
  it('rejects malformed', () => {
    expect(isEmail('nope')).toBe(false)
    expect(isEmail('a@b')).toBe(false)
    expect(isEmail('a b@c.com')).toBe(false)
    expect(isEmail('')).toBe(false)
  })
})
