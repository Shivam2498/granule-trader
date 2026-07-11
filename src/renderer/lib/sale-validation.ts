// Pure save-gating logic for the New Sale screen. No React, no window.api — unit-tested.
import { EWAY_BILL_THRESHOLD, ewayBillRequired } from '@shared/tax'
import { formatINR } from './format'

/** One lot row's draw, paired with how much stock that lot still has. */
export interface LotDraw {
  include: boolean
  qty: number
  rate: number
  available: number
}

/** The whole sale form's gateable state. `lots` is every visible lot; helpers filter to the ticked ones. */
export interface SaleFormState {
  invoiceNumber: string
  hasBuyer: boolean
  vehicle: string
  lots: LotDraw[]
  /** Invoice total incl. GST and round-off — what the e-way bill threshold is measured against. */
  total: number
  ewayNo: string
  ewayDate: string
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
  if (!s.invoiceNumber.trim()) return 'Enter an invoice number.'
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
  // Checked last on purpose: the total is only meaningful once the lots are settled, so asking
  // for an e-way bill before then would nag about a figure the user hasn't finished building.
  if (ewayBillRequired(s.total)) {
    const over = `This sale comes to ${formatINR(s.total)}, which is over ${formatINR(EWAY_BILL_THRESHOLD)}`
    if (!s.ewayNo.trim()) return `${over} — enter the e-way bill number.`
    if (!s.ewayDate.trim()) return `${over} — enter the e-way bill date.`
  }
  return ''
}
