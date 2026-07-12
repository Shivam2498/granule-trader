// Pure save-gating logic for the New Sale screen. No React, no window.api — unit-tested.
import type { AvailableLot } from '@shared/types'
import { EWAY_BILL_THRESHOLD, ewayBillRequired } from '@shared/tax'
import { formatINR } from './format'
import { type SaleLineDraft, lineError } from './sale-lines'

/** The whole sale form's gateable state. A sale is a set of deals — one per material. */
export interface SaleFormState {
  invoiceNumber: string
  hasBuyer: boolean
  vehicle: string
  lines: SaleLineDraft[]
  lots: AvailableLot[]
  /** Invoice total incl. GST and round-off — what the e-way bill threshold is measured against. */
  total: number
  ewayNo: string
  ewayDate: string
}

/** Whole-form gate: a single plain-English reason Save is off, or '' when the form may be saved. */
export function saleFormError(s: SaleFormState): string {
  if (!s.invoiceNumber.trim()) return 'Enter an invoice number.'
  if (!s.hasBuyer) return 'Please choose a buyer.'
  if (!s.vehicle.trim()) return 'Enter the vehicle number.'
  if (s.lines.length === 0) return 'Add at least one material to sell.'
  for (const line of s.lines) {
    const e = lineError(line, s.lots)
    if (e) return `${line.hsn_code}: ${e}`
  }
  // Checked last on purpose: the total is only meaningful once the lines are settled, so asking
  // for an e-way bill before then would nag about a figure the user hasn't finished building.
  if (ewayBillRequired(s.total)) {
    const over = `This sale comes to ${formatINR(s.total)}, which is over ${formatINR(EWAY_BILL_THRESHOLD)}`
    if (!s.ewayNo.trim()) return `${over} — enter the e-way bill number.`
    if (!s.ewayDate.trim()) return `${over} — enter the e-way bill date.`
  }
  return ''
}
