import { describe, it, expect } from 'vitest'
import { fillerHeightPx, ITEMS_AREA_PX, ITEM_ROW_PX } from '../../src/renderer/invoice/items-layout'

describe('fillerHeightPx', () => {
  const region = (lines: number) => lines * ITEM_ROW_PX + fillerHeightPx(lines)

  it('pads a single-line invoice out to the reserved area', () => {
    expect(region(1)).toBe(ITEMS_AREA_PX)
  })

  it('keeps the item region the same height as lines are added', () => {
    expect(region(2)).toBe(ITEMS_AREA_PX)
    expect(region(3)).toBe(ITEMS_AREA_PX)
    expect(region(4)).toBe(ITEMS_AREA_PX)
  })

  it('shrinks the filler as lines take up more of the area', () => {
    expect(fillerHeightPx(1)).toBeGreaterThan(fillerHeightPx(2))
    expect(fillerHeightPx(2)).toBeGreaterThan(fillerHeightPx(3))
  })

  it('collapses to zero once the lines fill the area, and never goes negative', () => {
    expect(fillerHeightPx(5)).toBe(0)
    expect(fillerHeightPx(20)).toBe(0)
  })

  it('lets the table grow naturally past the reserved area', () => {
    expect(region(20)).toBe(20 * ITEM_ROW_PX)   // no filler, just the rows
  })
})
