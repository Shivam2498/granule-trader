import { describe, it, expect } from 'vitest'
import { cleanNumber, parseDateMDY, fyFromDate, seqFromCode, fyCodeFromCode, round2 } from '../../scripts/purchase-import.mjs'

describe('cleanNumber', () => {
  it('strips thousands commas', () => { expect(cleanNumber('51,000.00')).toBe(51000) })
  it('treats blank as zero', () => { expect(cleanNumber('')).toBe(0) })
  it('keeps negatives', () => { expect(cleanNumber('-1.2')).toBe(-1.2) })
  it('returns NaN for non-numeric', () => { expect(Number.isNaN(cleanNumber('abc'))).toBe(true) })
})

describe('parseDateMDY', () => {
  it('parses M/D/YYYY', () => { expect(parseDateMDY('1/12/2026')).toBe('2026-01-12') })
  it('pads single digits', () => { expect(parseDateMDY('4/1/2025')).toBe('2025-04-01') })
  it('rejects an impossible date', () => { expect(parseDateMDY('2/30/2025')).toBe(null) })
  it('rejects garbage', () => { expect(parseDateMDY('not a date')).toBe(null) })
})

describe('fyFromDate', () => {
  it('April starts a new FY', () => { expect(fyFromDate('2025-04-01')).toEqual({ code: '2526', label: '2025-26' }) })
  it('March is the prior FY', () => { expect(fyFromDate('2026-03-31')).toEqual({ code: '2526', label: '2025-26' }) })
  it('next FY', () => { expect(fyFromDate('2026-04-01')).toEqual({ code: '2627', label: '2026-27' }) })
})

describe('seqFromCode / fyCodeFromCode', () => {
  it('reads the leading sequence', () => { expect(seqFromCode('082/2526')).toBe(82) })
  it('reads the FY token', () => { expect(fyCodeFromCode('082/2526')).toBe('2526') })
  it('missing token → empty', () => { expect(fyCodeFromCode('82')).toBe('') })
})

describe('round2', () => {
  it('rounds symmetrically', () => { expect(round2(-1.005)).toBe(-1.01); expect(round2(1.005)).toBe(1.01) })
})
