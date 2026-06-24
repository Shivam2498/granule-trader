import { describe, it, expect } from 'vitest'
import { allocationSummary } from '../../src/renderer/lib/allocation'
describe('allocationSummary', () => {
  it('sums quantity and line amounts', () => {
    const r = allocationSummary([
      { purchase_id: 1, qty_drawn_kg: 600, rate_per_kg: 80 },
      { purchase_id: 2, qty_drawn_kg: 400, rate_per_kg: 90 }
    ])
    expect(r).toEqual({ totalQty: 1000, amount: 84000 })
  })
  it('handles an empty list', () => { expect(allocationSummary([])).toEqual({ totalQty: 0, amount: 0 }) })
})
