import type { AvailableLot } from '@shared/types'

export interface UiLine { purchase_item_id: number; qty_drawn_kg: number; rate_per_kg: number }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export function allocationSummary(lines: UiLine[]): { totalQty: number; amount: number } {
  let totalQty = 0, amount = 0
  for (const l of lines) { totalQty = r2(totalQty + l.qty_drawn_kg); amount = r2(amount + r2(l.qty_drawn_kg * l.rate_per_kg)) }
  return { totalQty, amount }
}

export interface LotFilter { hsn?: string; query?: string }

/**
 * Narrows the sellable lots to what the user is looking for. `hsn` is an exact material match;
 * `query` is a loose, case-insensitive match on the lot code or its description — the two things
 * a user can actually recall about a lot.
 */
export function filterLots(lots: AvailableLot[], f: LotFilter = {}): AvailableLot[] {
  const q = (f.query ?? '').trim().toLowerCase()
  return lots.filter(l => {
    if (f.hsn && l.hsn_code !== f.hsn) return false
    if (!q) return true
    return l.our_code.toLowerCase().includes(q) || (l.description ?? '').toLowerCase().includes(q)
  })
}

export interface FifoDraw { purchase_item_id: number; qty: number }
export interface FifoResult {
  draws: FifoDraw[]
  /** Quantity that could NOT be met from the available lots. 0 when the fill succeeded outright. */
  shortfall: number
}

/**
 * Fills `qtyKg` of one material from the oldest lots first, never taking more from a lot than it
 * has. Callers pass only the lots still up for grabs (i.e. excluding ones already on the sale), so
 * a fill adds to the selection rather than fighting with it.
 *
 * `lots` is assumed to arrive oldest-first (listAvailableLots orders by invoice date), but it is
 * sorted defensively here — FIFO silently picking the wrong lot would be very hard to spot.
 */
export function fifoFill(lots: AvailableLot[], hsn: string, qtyKg: number): FifoResult {
  let left = r2(qtyKg)
  if (left <= 0) return { draws: [], shortfall: 0 }

  const candidates = lots
    .filter(l => l.hsn_code === hsn && l.available_kg > 0)
    .slice()
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.purchase_item_id - b.purchase_item_id)

  const draws: FifoDraw[] = []
  for (const lot of candidates) {
    if (left <= 0) break
    const take = r2(Math.min(left, lot.available_kg))
    if (take <= 0) continue
    draws.push({ purchase_item_id: lot.purchase_item_id, qty: take })
    left = r2(left - take)
  }
  return { draws, shortfall: r2(Math.max(0, left)) }
}
