import { describe, it, expect } from 'vitest'
import { groupByMonth, monthLabel } from '../../src/renderer/lib/group'

describe('groupByMonth', () => {
  it('buckets items by the YYYY-MM of their date', () => {
    const items = [
      { id: 1, d: '2026-06-10' },
      { id: 2, d: '2026-06-02' },
      { id: 3, d: '2026-05-20' },
    ]
    const groups = groupByMonth(items, i => i.d)
    expect(groups.map(g => g.key)).toEqual(['2026-06', '2026-05'])
    expect(groups[0].items.map(i => i.id)).toEqual([1, 2])
    expect(groups[1].items.map(i => i.id)).toEqual([3])
  })

  it('orders the undated bucket first, then months descending', () => {
    const items = [
      { id: 1, d: '2026-05-01' },
      { id: 2, d: null },
      { id: 3, d: '2026-06-01' },
      { id: 4, d: '' },
    ]
    const groups = groupByMonth(items, i => i.d)
    expect(groups.map(g => g.key)).toEqual(['undated', '2026-06', '2026-05'])
    expect(groups[0].items.map(i => i.id)).toEqual([2, 4])
  })

  it('preserves input order within each group', () => {
    const items = [
      { id: 1, d: '2026-06-01' },
      { id: 2, d: '2026-06-15' },
      { id: 3, d: '2026-06-09' },
    ]
    const groups = groupByMonth(items, i => i.d)
    expect(groups[0].items.map(i => i.id)).toEqual([1, 2, 3])
  })
})

describe('monthLabel', () => {
  it('maps a YYYY-MM key to "Month YYYY"', () => {
    expect(monthLabel('2026-06')).toBe('June 2026')
    expect(monthLabel('2026-01')).toBe('January 2026')
    expect(monthLabel('2025-12')).toBe('December 2025')
  })
  it('maps the undated key to "Undated"', () => {
    expect(monthLabel('undated')).toBe('Undated')
  })
})
