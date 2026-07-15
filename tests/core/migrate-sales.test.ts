import { describe, it, expect } from 'vitest'
import { excelSerialToISO } from '../../src/main/core/migrate-sales'

describe('excelSerialToISO', () => {
  it('converts known anchors', () => {
    expect(excelSerialToISO(46023)).toBe('2026-01-01')   // hand-checked anchor
    expect(excelSerialToISO(46114)).toBe('2026-04-02')   // RP/001 invoice date
  })
  it('accepts a numeric string', () => {
    expect(excelSerialToISO('46023')).toBe('2026-01-01')
  })
})
