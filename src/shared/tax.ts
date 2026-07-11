import { round2 } from './money'
import type { TaxResult } from './types'

/**
 * GST requires an e-way bill once a consignment's value exceeds ₹50,000. "Value" is the
 * invoice total the buyer pays — taxable amount plus GST plus round-off — not the pre-tax
 * amount, so a ₹45,000 sale at 18% crosses the line at ₹53,100.
 */
export const EWAY_BILL_THRESHOLD = 50000

export function ewayBillRequired(invoiceTotal: number): boolean {
  return invoiceTotal > EWAY_BILL_THRESHOLD
}

export interface ComputeTaxInput {
  amount: number; gstRate: number
  placeOfSupplyState: string; homeState: string
  tcs?: number; roundoff?: number
}

function isIntra(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function computeTax(input: ComputeTaxInput): TaxResult {
  const { amount, gstRate } = input
  const tcs = input.tcs ?? 0
  const roundoff = input.roundoff ?? 0
  const intra = isIntra(input.placeOfSupplyState, input.homeState)
  const cgst = intra ? round2((amount * gstRate) / 2 / 100) : 0
  const sgst = cgst
  const igst = intra ? 0 : round2((amount * gstRate) / 100)
  const total = round2(amount + cgst + sgst + igst + tcs + roundoff)
  return { taxable_amount: round2(amount), cgst, sgst, igst, tcs: round2(tcs), roundoff: round2(roundoff), total }
}

/** One line of a purchase invoice. `amount` is used only when no rate is given (legacy/import rows). */
export interface PurchaseTaxLine {
  qty_kg: number; rate_per_kg?: number; amount?: number; gst_rate: number; hsn_code: string
}
export interface ComputePurchaseTaxInput {
  lines: PurchaseTaxLine[]
  placeOfSupplyState: string; homeState: string
  tcs?: number; roundoff?: number
  /** When the user types an IGST figure by hand, it wins over the computed one. */
  igstManual?: number | null
}

export function lineAmount(l: PurchaseTaxLine): number {
  return l.rate_per_kg && l.rate_per_kg > 0 ? round2(l.qty_kg * l.rate_per_kg) : round2(l.amount ?? 0)
}

/**
 * Tax for a whole purchase invoice, summed across its lines. Lines are grouped by HSN + GST rate
 * before the rate is applied, so a two-material invoice at different rates is taxed correctly —
 * the same grouping the sale side uses.
 */
export function computePurchaseTax(input: ComputePurchaseTaxInput): TaxResult & { totalQty: number } {
  const tcs = round2(input.tcs ?? 0)
  const roundoff = round2(input.roundoff ?? 0)
  const intra = isIntra(input.placeOfSupplyState, input.homeState)

  const byRate = new Map<string, { rate: number; amount: number }>()
  let taxable = 0, totalQty = 0
  for (const l of input.lines) {
    const amt = lineAmount(l)
    taxable = round2(taxable + amt)
    totalQty = round2(totalQty + l.qty_kg)
    const key = `${l.hsn_code}@${l.gst_rate}`
    const prev = byRate.get(key)
    byRate.set(key, { rate: l.gst_rate, amount: round2((prev?.amount ?? 0) + amt) })
  }

  let cgst = 0, sgst = 0, igst = 0
  for (const g of byRate.values()) {
    if (intra) { cgst = round2(cgst + round2((g.amount * g.rate) / 2 / 100)); sgst = cgst }
    else { igst = round2(igst + round2((g.amount * g.rate) / 100)) }
  }
  if (input.igstManual != null) igst = round2(input.igstManual)

  const total = round2(taxable + cgst + sgst + igst + tcs + roundoff)
  return { taxable_amount: taxable, cgst, sgst, igst, tcs, roundoff, total, totalQty }
}

export interface SaleTaxLine { qty_drawn_kg: number; rate_per_kg: number; gst_rate: number; hsn_code: string }
export interface ComputeSaleTaxInput {
  lines: SaleTaxLine[]; placeOfSupplyState: string; homeState: string; roundoff?: number
}
export interface SaleTaxResult {
  taxable: number; cgst: number; sgst: number; igst: number; roundoff: number; total: number; totalQty: number
}

export function computeSaleTax(input: ComputeSaleTaxInput): SaleTaxResult {
  const roundoff = input.roundoff ?? 0
  const intra = isIntra(input.placeOfSupplyState, input.homeState)
  const byRate = new Map<string, { rate: number; amount: number }>()   // `${hsn_code}@${gst_rate}` -> { rate, amount }
  let taxable = 0, totalQty = 0
  for (const l of input.lines) {
    const lineAmount = round2(l.qty_drawn_kg * l.rate_per_kg)
    taxable = round2(taxable + lineAmount)
    totalQty = round2(totalQty + l.qty_drawn_kg)
    const key = `${l.hsn_code}@${l.gst_rate}`
    const existing = byRate.get(key)
    byRate.set(key, { rate: l.gst_rate, amount: round2((existing?.amount ?? 0) + lineAmount) })
  }
  let cgst = 0, sgst = 0, igst = 0
  for (const g of byRate.values()) {
    if (intra) { cgst = round2(cgst + round2((g.amount * g.rate) / 2 / 100)); sgst = cgst }
    else { igst = round2(igst + round2((g.amount * g.rate) / 100)) }
  }
  const total = round2(taxable + cgst + sgst + igst + roundoff)
  return { taxable, cgst, sgst, igst, roundoff: round2(roundoff), total, totalQty }
}
