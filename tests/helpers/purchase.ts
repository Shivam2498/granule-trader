import type Database from 'better-sqlite3'
import { createPurchase, updatePurchase, getPurchaseItems, type NewPurchase } from '../../src/main/core/purchase'
import type { Purchase } from '../../src/shared/types'

/**
 * A purchase used to be a single line, so most tests describe one with flat fields
 * (hsn_code / qty_kg / rate_per_kg / amount / gst_rate). A purchase now holds line items, and
 * each item is the stock lot. These helpers adapt the flat shape to a one-item purchase so those
 * tests keep exercising the real core; multi-line behaviour is tested directly against NewPurchase.
 */
export interface FlatPurchase {
  our_code: string
  invoice_date: string
  supplier_invoice_number?: string
  party?: string
  party_state?: string
  party_city?: string
  party_pincode?: string
  party_address?: string
  homeState?: string
  hsn_code?: string
  description?: string
  qty_kg: number
  rate_per_kg?: number
  amount?: number
  gst_rate?: number
  igst_manual?: number
  tcs?: number
  roundoff?: number
  payment_status?: 'pending' | 'done'
  payment_date?: string | null
  eway_bill_no?: string
  eway_bill_date?: string
  vehicle?: string
  supplier_id?: number | null
}

export function flatToNewPurchase(f: FlatPurchase): NewPurchase {
  return {
    our_code: f.our_code,
    supplier_invoice_number: f.supplier_invoice_number ?? '',
    invoice_date: f.invoice_date,
    party: f.party ?? '',
    party_state: f.party_state ?? '',
    party_city: f.party_city,
    party_pincode: f.party_pincode,
    party_address: f.party_address,
    homeState: f.homeState ?? '',
    igst_manual: f.igst_manual,
    tcs: f.tcs,
    roundoff: f.roundoff,
    payment_status: f.payment_status,
    payment_date: f.payment_date,
    eway_bill_no: f.eway_bill_no,
    eway_bill_date: f.eway_bill_date,
    vehicle: f.vehicle,
    supplier_id: f.supplier_id,
    items: [{
      hsn_code: f.hsn_code ?? '',
      description: f.description,
      qty_kg: f.qty_kg,
      rate_per_kg: f.rate_per_kg,
      amount: f.amount,
      gst_rate: f.gst_rate ?? 18
    }]
  }
}

export function mkPurchase(db: Database.Database, f: FlatPurchase): Purchase {
  return createPurchase(db, flatToNewPurchase(f))
}

/** Update a purchase from the flat shape, keeping its existing single line (so stock is preserved). */
export function editPurchase(db: Database.Database, id: number, f: FlatPurchase): Purchase {
  const existing = getPurchaseItems(db, id)[0]
  const input = flatToNewPurchase(f)
  input.items[0].id = existing?.id
  return updatePurchase(db, id, input)
}

/** The stock lot of a single-line purchase. */
export function lotIdOf(db: Database.Database, purchaseId: number): number {
  return getPurchaseItems(db, purchaseId)[0].id
}

/** Live remaining quantity of a single-line purchase's lot. */
export function remainingOf(db: Database.Database, purchaseId: number): number {
  return getPurchaseItems(db, purchaseId)[0].qty_remaining_kg
}
