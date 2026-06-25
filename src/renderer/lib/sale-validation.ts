// Pure save-gating logic for the New Sale screen. No React, no window.api — unit-tested.

/** One lot row's draw, paired with how much stock that lot still has. */
export interface LotDraw {
  include: boolean
  qty: number
  rate: number
  available: number
}

/** The whole sale form's gateable state. `lots` is every visible lot; helpers filter to the ticked ones. */
export interface SaleFormState {
  hasBuyer: boolean
  vehicle: string
  lots: LotDraw[]
}

/** Per-lot message for a ticked row. Empty string means the row is fine (or not ticked). */
export function lotDrawError(d: LotDraw): string {
  if (!d.include) return ''
  if (d.qty <= 0) return 'Enter a quantity.'
  if (d.qty > d.available) return `Only ${d.available} kg available in this lot.`
  if (d.rate <= 0) return 'Enter a selling rate.'
  return ''
}

/** Whole-form gate: a single plain-English reason Save is off, or '' when the form may be saved. */
export function saleFormError(s: SaleFormState): string {
  if (!s.hasBuyer) return 'Please choose a buyer.'
  if (!s.vehicle.trim()) return 'Enter the vehicle number.'
  // "ticked" = the checkbox is on. A ticked-but-empty lot is not "no lot chosen";
  // it falls through to the per-lot loop below, which asks for its quantity.
  const ticked = s.lots.filter(l => l.include)
  if (ticked.length === 0) return 'Tick at least one stock lot, then enter its quantity and selling rate.'
  for (const l of s.lots) {
    const e = lotDrawError(l)
    if (e) return e
  }
  return ''
}
