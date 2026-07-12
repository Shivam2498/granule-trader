import { describe, it, expect } from 'vitest'
import {
  newLine, reallocate, allocateLine, allocatedQty, lineAmount, weightedCost, lineError,
  toApiLines, linesFromAllocations, availableOf, type SaleLineDraft
} from '../../src/renderer/lib/sale-lines'
import type { AvailableLot } from '../../src/shared/types'

const lot = (o: Partial<AvailableLot> & { purchase_item_id: number }): AvailableLot => ({
  purchase_id: 1, our_code: `LOT${o.purchase_item_id}`, party: 'Reliance', hsn_code: 'PP',
  description: 'PP', invoice_date: '2026-01-12', rate_per_kg: 80, available_kg: 5000, ...o
})

// PP across three lots at different costs; HDPE on its own.
const LOTS = [
  lot({ purchase_item_id: 1, invoice_date: '2026-01-12', available_kg: 5000, rate_per_kg: 78 }),
  lot({ purchase_item_id: 2, invoice_date: '2026-01-20', available_kg: 5000, rate_per_kg: 80 }),
  lot({ purchase_item_id: 3, invoice_date: '2026-02-02', available_kg: 4000, rate_per_kg: 85 }),
  lot({ purchase_item_id: 9, hsn_code: 'HDPE', available_kg: 900, rate_per_kg: 70 })
]

describe('availableOf', () => {
  it('totals a material across its lots', () => {
    expect(availableOf(LOTS, 'PP')).toBe(14000)
    expect(availableOf(LOTS, 'HDPE')).toBe(900)
    expect(availableOf(LOTS, 'NYLON')).toBe(0)
  })
})

describe('newLine', () => {
  it('allocates the quantity oldest-first without the user choosing lots', () => {
    const line = newLine(LOTS, 'PP', 12000, 92)
    expect(line.allocations).toEqual([
      { purchase_item_id: 1, qty: 5000 },
      { purchase_item_id: 2, qty: 5000 },
      { purchase_item_id: 3, qty: 2000 }
    ])
    expect(line.manual).toBe(false)
    expect(lineAmount(line)).toBe(12000 * 92)
  })
})

describe('reallocate', () => {
  it('re-runs the fill when the quantity changes', () => {
    const line = { ...newLine(LOTS, 'PP', 12000, 92), qty_kg: 3000 }
    expect(reallocate(line, LOTS).allocations).toEqual([{ purchase_item_id: 1, qty: 3000 }])
  })

  it('leaves hand-picked lots alone', () => {
    const manual: SaleLineDraft = {
      hsn_code: 'PP', qty_kg: 500, rate_per_kg: 92, manual: true,
      allocations: [{ purchase_item_id: 3, qty: 500 }]   // deliberately the NEWEST lot
    }
    expect(reallocate(manual, LOTS).allocations).toEqual([{ purchase_item_id: 3, qty: 500 }])
  })
})

describe('weightedCost', () => {
  it('averages the cost across the lots the line actually draws from', () => {
    const line = newLine(LOTS, 'PP', 12000, 92)
    // 5000@78 + 5000@80 + 2000@85 = 390000 + 400000 + 170000 = 960000 over 12000 kg
    expect(weightedCost(line, LOTS)).toBe(80)
  })
  it('is zero before anything is allocated', () => {
    expect(weightedCost({ hsn_code: 'PP', qty_kg: 0, rate_per_kg: 0, allocations: [], manual: false }, LOTS)).toBe(0)
  })
})

describe('lineError', () => {
  const ok = () => newLine(LOTS, 'PP', 1000, 92)

  it('passes a well-formed line', () => {
    expect(lineError(ok(), LOTS)).toBe('')
  })
  it('asks for a quantity', () => {
    expect(lineError({ ...ok(), qty_kg: 0 }, LOTS)).toBe('Enter a quantity.')
  })
  it('asks for a selling rate', () => {
    expect(lineError({ ...ok(), rate_per_kg: 0 }, LOTS)).toBe('Enter a selling rate.')
  })
  it('reports the material total when there is not enough stock', () => {
    expect(lineError({ ...newLine(LOTS, 'PP', 20000, 92), qty_kg: 20000 }, LOTS))
      .toBe('Only 14000 kg of PP is available — you asked for 20000 kg.')
  })
  it('catches hand-picked lots that do not add up to the quantity sold', () => {
    const drifted: SaleLineDraft = {
      hsn_code: 'PP', qty_kg: 1000, rate_per_kg: 92, manual: true,
      allocations: [{ purchase_item_id: 1, qty: 600 }]
    }
    expect(lineError(drifted, LOTS)).toBe('The lots add up to 600 kg but the line sells 1000 kg. Adjust the lots to match.')
  })
  it('catches a hand-picked lot that is over-drawn', () => {
    const over: SaleLineDraft = {
      hsn_code: 'PP', qty_kg: 4500, rate_per_kg: 92, manual: true,
      allocations: [{ purchase_item_id: 3, qty: 4500 }]   // lot 3 only holds 4000
    }
    expect(lineError(over, LOTS)).toBe('Lot LOT3 only has 4000 kg available.')
  })
})

describe('toApiLines', () => {
  it('flattens deals into per-lot allocations that all carry the line rate', () => {
    const lines = [newLine(LOTS, 'PP', 12000, 92), newLine(LOTS, 'HDPE', 900, 85)]
    const api = toApiLines(lines, () => 18)
    expect(api).toEqual([
      { purchase_item_id: 1, qty_drawn_kg: 5000, rate_per_kg: 92, hsn_code: 'PP', gst_rate: 18 },
      { purchase_item_id: 2, qty_drawn_kg: 5000, rate_per_kg: 92, hsn_code: 'PP', gst_rate: 18 },
      { purchase_item_id: 3, qty_drawn_kg: 2000, rate_per_kg: 92, hsn_code: 'PP', gst_rate: 18 },
      { purchase_item_id: 9, qty_drawn_kg: 900, rate_per_kg: 85, hsn_code: 'HDPE', gst_rate: 18 }
    ])
    // one rate per material is exactly what lets the invoice regroup them into one printed row
    expect(new Set(api.filter(a => a.hsn_code === 'PP').map(a => a.rate_per_kg)).size).toBe(1)
  })

  it('drops zero-quantity allocations', () => {
    const line: SaleLineDraft = {
      hsn_code: 'PP', qty_kg: 100, rate_per_kg: 92, manual: true,
      allocations: [{ purchase_item_id: 1, qty: 100 }, { purchase_item_id: 2, qty: 0 }]
    }
    expect(toApiLines([line], () => 18)).toHaveLength(1)
  })
})

describe('linesFromAllocations', () => {
  it('rebuilds one deal per material when editing a saved sale', () => {
    const lines = linesFromAllocations([
      { purchase_item_id: 1, hsn_code: 'PP', qty_drawn_kg: 5000, rate_per_kg: 92 },
      { purchase_item_id: 2, hsn_code: 'PP', qty_drawn_kg: 2000, rate_per_kg: 92 },
      { purchase_item_id: 9, hsn_code: 'HDPE', qty_drawn_kg: 900, rate_per_kg: 85 }
    ])
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatchObject({ hsn_code: 'PP', qty_kg: 7000, rate_per_kg: 92, manual: true })
    expect(allocatedQty(lines[0])).toBe(7000)
    expect(lines[1]).toMatchObject({ hsn_code: 'HDPE', qty_kg: 900, rate_per_kg: 85 })
  })

  it('marks the rebuilt lines manual, so re-saving keeps the exact lots that were sold', () => {
    const lines = linesFromAllocations([{ purchase_item_id: 3, hsn_code: 'PP', qty_drawn_kg: 500, rate_per_kg: 92 }])
    expect(reallocate(lines[0], LOTS).allocations).toEqual([{ purchase_item_id: 3, qty: 500 }])
  })
})

describe('allocateLine', () => {
  it('reports a shortfall rather than silently under-filling', () => {
    expect(allocateLine(LOTS, 'HDPE', 2000).shortfall).toBe(1100)   // only 900 on hand
  })
})
