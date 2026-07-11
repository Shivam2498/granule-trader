import { describe, it, expect } from 'vitest'
import { allocationSummary, filterLots, fifoFill } from '../../src/renderer/lib/allocation'
import type { AvailableLot } from '../../src/shared/types'

const lot = (o: Partial<AvailableLot> & { purchase_item_id: number }): AvailableLot => ({
  purchase_id: 1, our_code: '0001/2526', party: 'Reliance', hsn_code: '39021000', description: 'PP',
  invoice_date: '2026-01-12', rate_per_kg: 80, available_kg: 1000, ...o
})

describe('allocationSummary', () => {
  it('sums quantity and line amounts', () => {
    const r = allocationSummary([
      { purchase_item_id: 1, qty_drawn_kg: 600, rate_per_kg: 80 },
      { purchase_item_id: 2, qty_drawn_kg: 400, rate_per_kg: 90 }
    ])
    expect(r).toEqual({ totalQty: 1000, amount: 84000 })
  })
  it('handles an empty list', () => { expect(allocationSummary([])).toEqual({ totalQty: 0, amount: 0 }) })
})

describe('filterLots', () => {
  const lots = [
    lot({ purchase_item_id: 1, our_code: '0012/2526', hsn_code: '39021000', description: 'PP Granules' }),
    lot({ purchase_item_id: 2, our_code: '0015/2526', hsn_code: '39012000', description: 'HDPE' }),
    lot({ purchase_item_id: 3, our_code: '0019/2526-2', hsn_code: '39021000', description: 'PP Repro' })
  ]

  it('returns everything when nothing is asked for', () => {
    expect(filterLots(lots)).toHaveLength(3)
  })
  it('narrows to one material', () => {
    expect(filterLots(lots, { hsn: '39021000' }).map(l => l.purchase_item_id)).toEqual([1, 3])
  })
  it('matches a lot code, including a line suffix', () => {
    expect(filterLots(lots, { query: '0019' }).map(l => l.purchase_item_id)).toEqual([3])
    expect(filterLots(lots, { query: '-2' }).map(l => l.purchase_item_id)).toEqual([3])
  })
  it('matches the description, case-insensitively', () => {
    expect(filterLots(lots, { query: 'hdpe' }).map(l => l.purchase_item_id)).toEqual([2])
  })
  it('combines material and query', () => {
    expect(filterLots(lots, { hsn: '39021000', query: 'repro' }).map(l => l.purchase_item_id)).toEqual([3])
  })
  it('returns nothing when the query matches nothing', () => {
    expect(filterLots(lots, { query: 'nylon' })).toEqual([])
  })
})

describe('fifoFill', () => {
  // deliberately out of date order, to prove it does not just trust the input order
  const lots = [
    lot({ purchase_item_id: 3, invoice_date: '2026-02-02', available_kg: 4000 }),
    lot({ purchase_item_id: 1, invoice_date: '2026-01-12', available_kg: 5000 }),
    lot({ purchase_item_id: 2, invoice_date: '2026-01-20', available_kg: 5000 }),
    lot({ purchase_item_id: 9, invoice_date: '2026-01-01', available_kg: 9999, hsn_code: '39012000' })  // other material
  ]

  it('takes from the oldest lot first', () => {
    expect(fifoFill(lots, '39021000', 3000)).toEqual({ draws: [{ purchase_item_id: 1, qty: 3000 }], shortfall: 0 })
  })

  it('spills into the next-oldest lots in date order', () => {
    expect(fifoFill(lots, '39021000', 12000)).toEqual({
      draws: [
        { purchase_item_id: 1, qty: 5000 },
        { purchase_item_id: 2, qty: 5000 },
        { purchase_item_id: 3, qty: 2000 }
      ],
      shortfall: 0
    })
  })

  it('never takes more from a lot than it has', () => {
    const { draws } = fifoFill(lots, '39021000', 12000)
    for (const d of draws) {
      const source = lots.find(l => l.purchase_item_id === d.purchase_item_id)!
      expect(d.qty).toBeLessThanOrEqual(source.available_kg)
    }
  })

  it('ignores lots of a different material', () => {
    const { draws } = fifoFill(lots, '39021000', 20000)
    expect(draws.map(d => d.purchase_item_id)).not.toContain(9)
  })

  it('reports the shortfall when stock runs out', () => {
    const r = fifoFill(lots, '39021000', 20000)   // only 14000 available
    expect(r.draws.map(d => d.qty).reduce((a, b) => a + b, 0)).toBe(14000)
    expect(r.shortfall).toBe(6000)
  })

  it('is a no-op for a zero or negative quantity', () => {
    expect(fifoFill(lots, '39021000', 0)).toEqual({ draws: [], shortfall: 0 })
    expect(fifoFill(lots, '39021000', -5)).toEqual({ draws: [], shortfall: 0 })
  })

  it('reports the whole quantity as short when the material has no stock', () => {
    expect(fifoFill(lots, '999999', 500)).toEqual({ draws: [], shortfall: 500 })
  })
})
