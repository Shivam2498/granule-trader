// The printed invoice reserves a fixed-height area for the item lines so that the
// CGST/SGST/TOTAL rows always land at the same place on the page — the layout was matched
// to the owner's original paper invoice.
//
// That reservation used to be a 130px height on the FIRST item row, which is only correct
// when a sale has exactly one line. With several HSN lines, row 1 stayed 130px tall while the
// rest were natural height, leaving a large gap under the first entry.
//
// Instead, every item row is now natural height and a trailing filler row absorbs whatever is
// left of the reserved area. The item region keeps its total height until the lines outgrow it,
// at which point the filler collapses to zero and the table grows normally.

/** Reserved height of the whole item region, in px. Matches the original single-line layout. */
export const ITEMS_AREA_PX = 130

/** Approximate printed height of one item row, in px. */
export const ITEM_ROW_PX = 26

/** Height of the filler row that pads the item region out to ITEMS_AREA_PX. Never negative. */
export function fillerHeightPx(lineCount: number, areaPx = ITEMS_AREA_PX, rowPx = ITEM_ROW_PX): number {
  return Math.max(0, areaPx - lineCount * rowPx)
}
