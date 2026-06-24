import { describe, it, expect } from 'vitest'
import { computeTax } from '../../src/main/core/tax'

describe('computeTax', () => {
  it('intra-state splits into CGST + SGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Gujarat', homeState: 'Gujarat' })
    expect(r).toMatchObject({ cgst: 90, sgst: 90, igst: 0, total: 1180 })
  })
  it('inter-state applies IGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Maharashtra', homeState: 'Gujarat' })
    expect(r).toMatchObject({ cgst: 0, sgst: 0, igst: 180, total: 1180 })
  })
  it('state match is case-insensitive', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: ' gujarat ', homeState: 'Gujarat' })
    expect(r.igst).toBe(0)
    expect(r.cgst).toBe(90)
  })
  it('adds tcs and roundoff to total', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Gujarat', homeState: 'Gujarat', tcs: 5, roundoff: 0.4 })
    expect(r.total).toBe(1185.4)
  })
  it('respects a non-default rate', () => {
    const r = computeTax({ amount: 1000, gstRate: 5, placeOfSupplyState: 'Goa', homeState: 'Gujarat' })
    expect(r.igst).toBe(50)
  })
})
