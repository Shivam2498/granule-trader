import { describe, it, expect } from 'vitest'
import { EWAY_BILL_THRESHOLD, ewayBillRequired } from '../../src/shared/tax'

describe('ewayBillRequired', () => {
  it('is not required below the threshold', () => {
    expect(ewayBillRequired(49999.99)).toBe(false)
  })
  it('is not required exactly at the threshold', () => {
    expect(ewayBillRequired(EWAY_BILL_THRESHOLD)).toBe(false)   // the rule is "exceeds 50,000"
  })
  it('is required above the threshold', () => {
    expect(ewayBillRequired(50000.01)).toBe(true)
    expect(ewayBillRequired(53100)).toBe(true)
  })
  it('uses the statutory 50,000 figure', () => {
    expect(EWAY_BILL_THRESHOLD).toBe(50000)
  })
})
import { computeTax, computeSaleTax } from '../../src/shared/tax'

describe('computeTax (purchases, single rate)', () => {
  it('intra-state splits CGST+SGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Gujarat', homeState: 'Gujarat' })
    expect(r).toMatchObject({ cgst: 90, sgst: 90, igst: 0, total: 1180 })
  })
  it('inter-state applies IGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Maharashtra', homeState: 'Gujarat' })
    expect(r).toMatchObject({ igst: 180, cgst: 0, sgst: 0, total: 1180 })
  })
})

describe('computeSaleTax (multi-rate)', () => {
  const homeState = 'Gujarat'
  it('single rate intra-state', () => {
    const r = computeSaleTax({ lines: [
      { qty_drawn_kg: 600, rate_per_kg: 80, gst_rate: 18, hsn_code: '3902' },
      { qty_drawn_kg: 400, rate_per_kg: 90, gst_rate: 18, hsn_code: '3902' }
    ], placeOfSupplyState: 'Gujarat', homeState })
    expect(r.taxable).toBe(84000)
    expect(r.cgst).toBe(7560); expect(r.sgst).toBe(7560); expect(r.igst).toBe(0)
    expect(r.total).toBe(99120); expect(r.totalQty).toBe(1000)
  })
  it('mixed rates intra-state sum per group', () => {
    const r = computeSaleTax({ lines: [
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 18, hsn_code: '3902' },  // 10000 @18 -> cgst/sgst 900 each
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 5, hsn_code: '3901' }    // 10000 @5  -> cgst/sgst 250 each
    ], placeOfSupplyState: 'Gujarat', homeState })
    expect(r.taxable).toBe(20000)
    expect(r.cgst).toBe(1150); expect(r.sgst).toBe(1150); expect(r.igst).toBe(0)
    expect(r.total).toBe(22300)
  })
  it('inter-state uses IGST per group', () => {
    const r = computeSaleTax({ lines: [
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 18, hsn_code: '3902' },
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 5, hsn_code: '3901' }
    ], placeOfSupplyState: 'Maharashtra', homeState })
    expect(r.cgst).toBe(0); expect(r.sgst).toBe(0)
    expect(r.igst).toBe(2300); expect(r.total).toBe(22300)
  })
  it('applies a negative round-off', () => {
    const r = computeSaleTax({ lines: [{ qty_drawn_kg: 10, rate_per_kg: 100, gst_rate: 18, hsn_code: '3902' }],
      placeOfSupplyState: 'Gujarat', homeState, roundoff: -0.40 })
    // taxable 1000, cgst 90, sgst 90 -> 1180 - 0.40 = 1179.60
    expect(r.total).toBe(1179.6)
  })
  it('groups by HSN+rate so two HSNs at the same rate are separate groups', () => {
    const r = computeSaleTax({ lines: [
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 18, hsn_code: '3902' },
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 18, hsn_code: '3901' }
    ], placeOfSupplyState: 'Gujarat', homeState: 'Gujarat' })
    expect(r.taxable).toBe(20000)
    expect(r.cgst).toBe(1800); expect(r.sgst).toBe(1800); expect(r.total).toBe(23600)
  })
})
