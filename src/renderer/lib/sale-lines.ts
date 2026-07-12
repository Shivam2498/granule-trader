// A sale is a set of DEALS, not a set of lots: "12,000 kg of PP at ₹92". Which lots the goods come
// out of is stock accounting, and the app does it (oldest first) so the user does not have to.
//
// A material appears at most once on an invoice, and a lot belongs to exactly one material, so two
// lines can never claim the same lot — no cross-line conflict to reason about.
import type { AvailableLot } from '@shared/types'
import { fifoFill } from './allocation'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface LineAllocation { purchase_item_id: number; qty: number }

export interface SaleLineDraft {
  hsn_code: string
  qty_kg: number
  /** The agreed selling rate for this material — one rate per material, per invoice. */
  rate_per_kg: number
  allocations: LineAllocation[]
  /** True once the user has hand-picked the lots; stops the FIFO fill from overwriting them. */
  manual: boolean
}

/** Lots of one material, oldest first. */
export function lotsOf(lots: AvailableLot[], hsn: string): AvailableLot[] {
  return lots.filter(l => l.hsn_code === hsn)
}

export function availableOf(lots: AvailableLot[], hsn: string): number {
  return r2(lotsOf(lots, hsn).reduce((a, l) => a + l.available_kg, 0))
}

/** Oldest-first allocation of `qty` of one material. Shortfall > 0 when there is not enough stock. */
export function allocateLine(lots: AvailableLot[], hsn: string, qty: number): { allocations: LineAllocation[]; shortfall: number } {
  const { draws, shortfall } = fifoFill(lots, hsn, qty)
  return { allocations: draws.map(d => ({ purchase_item_id: d.purchase_item_id, qty: d.qty })), shortfall }
}

export function newLine(lots: AvailableLot[], hsn: string, qty: number, rate: number): SaleLineDraft {
  const { allocations } = allocateLine(lots, hsn, qty)
  return { hsn_code: hsn, qty_kg: r2(qty), rate_per_kg: r2(rate), allocations, manual: false }
}

/** Re-runs the FIFO fill after a quantity change — unless the user has taken the lots into their own hands. */
export function reallocate(line: SaleLineDraft, lots: AvailableLot[]): SaleLineDraft {
  if (line.manual) return line
  return { ...line, allocations: allocateLine(lots, line.hsn_code, line.qty_kg).allocations }
}

export function allocatedQty(line: SaleLineDraft): number {
  return r2(line.allocations.reduce((a, x) => a + x.qty, 0))
}

export function lineAmount(line: SaleLineDraft): number {
  return r2(line.qty_kg * line.rate_per_kg)
}

/**
 * What the goods on this line actually cost us per kg — weighted across the lots it draws from.
 * This is the number to price against; a per-lot cost would have to be averaged in the user's head.
 */
export function weightedCost(line: SaleLineDraft, lots: AvailableLot[]): number {
  const qty = allocatedQty(line)
  if (qty <= 0) return 0
  const byId = new Map(lots.map(l => [l.purchase_item_id, l]))
  const total = line.allocations.reduce((a, x) => a + x.qty * (byId.get(x.purchase_item_id)?.rate_per_kg ?? 0), 0)
  return r2(total / qty)
}

/** One plain-English reason this line cannot be sold, or '' when it is fine. */
export function lineError(line: SaleLineDraft, lots: AvailableLot[]): string {
  if (r2(line.qty_kg) <= 0) return 'Enter a quantity.'
  if (r2(line.rate_per_kg) <= 0) return 'Enter a selling rate.'

  const have = availableOf(lots, line.hsn_code)
  if (r2(line.qty_kg) > have)
    return `Only ${have} kg of ${line.hsn_code} is available — you asked for ${r2(line.qty_kg)} kg.`

  // With hand-picked lots the two can drift apart; the sale must draw exactly what it bills for.
  const drawn = allocatedQty(line)
  if (drawn !== r2(line.qty_kg))
    return `The lots add up to ${drawn} kg but the line sells ${r2(line.qty_kg)} kg. Adjust the lots to match.`

  const byId = new Map(lots.map(l => [l.purchase_item_id, l]))
  for (const a of line.allocations) {
    const lot = byId.get(a.purchase_item_id)
    if (!lot) return `One of the chosen lots is no longer available. Remove this line and add it again.`
    if (r2(a.qty) > lot.available_kg) return `Lot ${lot.our_code} only has ${lot.available_kg} kg available.`
  }
  return ''
}

export interface ApiSaleLine {
  purchase_item_id: number; qty_drawn_kg: number; rate_per_kg: number; hsn_code: string; gst_rate: number
}

/**
 * Flattens the deals back into per-lot allocations for the database. Every lot of a line carries the
 * line's single selling rate, which is why the printed invoice regroups them into one row.
 */
export function toApiLines(lines: SaleLineDraft[], gstRateOf: (hsn: string) => number): ApiSaleLine[] {
  return lines.flatMap(line =>
    line.allocations
      .filter(a => a.qty > 0)
      .map(a => ({
        purchase_item_id: a.purchase_item_id,
        qty_drawn_kg: r2(a.qty),
        rate_per_kg: r2(line.rate_per_kg),
        hsn_code: line.hsn_code,
        gst_rate: gstRateOf(line.hsn_code)
      }))
  )
}

/** Rebuilds the deal view from a saved sale's allocations, so an edit shows what was actually done. */
export function linesFromAllocations(
  allocs: Array<{ purchase_item_id: number; hsn_code: string; qty_drawn_kg: number; rate_per_kg: number }>
): SaleLineDraft[] {
  const by = new Map<string, SaleLineDraft>()
  for (const a of allocs) {
    const line = by.get(a.hsn_code) ?? {
      hsn_code: a.hsn_code, qty_kg: 0, rate_per_kg: a.rate_per_kg, allocations: [], manual: true
    }
    line.qty_kg = r2(line.qty_kg + a.qty_drawn_kg)
    line.allocations.push({ purchase_item_id: a.purchase_item_id, qty: a.qty_drawn_kg })
    by.set(a.hsn_code, line)
  }
  return [...by.values()]
}
