import { round2 } from './money'
import type { TaxResult } from './types'

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

export interface SaleTaxLine { qty_drawn_kg: number; rate_per_kg: number; gst_rate: number }
export interface ComputeSaleTaxInput {
  lines: SaleTaxLine[]; placeOfSupplyState: string; homeState: string; roundoff?: number
}
export interface SaleTaxResult {
  taxable: number; cgst: number; sgst: number; igst: number; roundoff: number; total: number; totalQty: number
}

export function computeSaleTax(input: ComputeSaleTaxInput): SaleTaxResult {
  const roundoff = input.roundoff ?? 0
  const intra = isIntra(input.placeOfSupplyState, input.homeState)
  const byRate = new Map<number, number>()   // gst_rate -> summed amount
  let taxable = 0, totalQty = 0
  for (const l of input.lines) {
    const lineAmount = round2(l.qty_drawn_kg * l.rate_per_kg)
    taxable = round2(taxable + lineAmount)
    totalQty = round2(totalQty + l.qty_drawn_kg)
    byRate.set(l.gst_rate, round2((byRate.get(l.gst_rate) ?? 0) + lineAmount))
  }
  let cgst = 0, sgst = 0, igst = 0
  for (const [rate, amount] of byRate) {
    if (intra) { cgst = round2(cgst + round2((amount * rate) / 2 / 100)); sgst = cgst }
    else { igst = round2(igst + round2((amount * rate) / 100)) }
  }
  const total = round2(taxable + cgst + sgst + igst + roundoff)
  return { taxable, cgst, sgst, igst, roundoff: round2(roundoff), total, totalQty }
}
