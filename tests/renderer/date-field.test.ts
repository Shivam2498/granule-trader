import { describe, it, expect } from 'vitest'
import { parseDdmmyyyy } from '../../src/renderer/components/DateField'

const iso = (d: Date | null) => d
  ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  : null

describe('parseDdmmyyyy (typed date-picker input)', () => {
  it('parses a DD/MM/YYYY string to the correct day (round-trips to ISO)', () => {
    expect(iso(parseDdmmyyyy('16/04/2026'))).toBe('2026-04-16')
    expect(iso(parseDdmmyyyy('1/4/2026'))).toBe('2026-04-01')   // single-digit day/month
    expect(iso(parseDdmmyyyy(' 31/12/2025 '))).toBe('2025-12-31')
  })
  it('does NOT read it as MM/DD (16 is the day, 04 is the month)', () => {
    const d = parseDdmmyyyy('16/04/2026')!
    expect(d.getDate()).toBe(16)
    expect(d.getMonth()).toBe(3)   // April, 0-indexed
  })
  it('rejects an impossible date rather than rolling it over', () => {
    expect(parseDdmmyyyy('31/02/2026')).toBeNull()   // JS would roll to 03 March — we reject
    expect(parseDdmmyyyy('00/01/2026')).toBeNull()
  })
  it('rejects malformed input', () => {
    expect(parseDdmmyyyy('2026-04-16')).toBeNull()
    expect(parseDdmmyyyy('16-04-2026')).toBeNull()
    expect(parseDdmmyyyy('')).toBeNull()
    expect(parseDdmmyyyy('garbage')).toBeNull()
  })
})
