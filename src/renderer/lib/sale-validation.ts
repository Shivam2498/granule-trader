// Pure save-gating logic for the New Sale screen. No React, no window.api — unit-tested.
import { EWAY_BILL_THRESHOLD, ewayBillRequired } from '@shared/tax'
import { formatINR } from './format'

/** One chosen lot's draw, paired with how much stock that lot still has. */
export interface LotDraw {
  our_code: string
  qty: number
  rate: number
  available: number
}

/** The whole sale form's gateable state. `lots` is only the lots the user actually added. */
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

/** Per-row message for a chosen lot. Empty string means the row is fine. */
export function lotDrawError(d: LotDraw): string {
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
  if (s.lots.length === 0) return 'Choose stock to sell.'
  for (const l of s.lots) {
    const e = lotDrawError(l)
    if (e) return `${l.our_code}: ${e}`
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
