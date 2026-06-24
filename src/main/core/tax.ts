import { round2 } from './money'
import type { TaxResult } from '@shared/types'

export interface ComputeTaxInput {
  amount: number
  gstRate: number
  placeOfSupplyState: string
  homeState: string
  tcs?: number
  roundoff?: number
}

export function computeTax(input: ComputeTaxInput): TaxResult {
  const { amount, gstRate } = input
  const tcs = input.tcs ?? 0
  const roundoff = input.roundoff ?? 0
  const intra = input.placeOfSupplyState.trim().toLowerCase() === input.homeState.trim().toLowerCase()
  const cgst = intra ? round2((amount * gstRate) / 2 / 100) : 0
  const sgst = cgst
  const igst = intra ? 0 : round2((amount * gstRate) / 100)
  const total = round2(amount + cgst + sgst + igst + tcs + roundoff)
  return { taxable_amount: round2(amount), cgst, sgst, igst, tcs: round2(tcs), roundoff: round2(roundoff), total }
}
