import type Database from 'better-sqlite3'
import type { Purchase } from '@shared/types'
import { financialYear } from './financial-year'
import { computeTax } from './tax'
import { round2 } from './money'

export interface NewPurchase {
  our_code: string; supplier_invoice_number: string; invoice_date: string
  party: string; party_state: string; hsn_code: string
  party_city?: string; party_pincode?: string; party_address?: string
  qty_kg: number; rate_per_kg?: number; amount?: number; gst_rate: number; homeState: string
  igst_manual?: number; tcs?: number; roundoff?: number
  payment_status?: 'pending' | 'done'; payment_date?: string | null
  supplier_id?: number | null
}

export function parsePurchaseSeq(code: string): number {
  const m = code.trim().match(/^(\d+)/)
  return m ? Number(m[1]) : 0
}

// NOTE: numbering is scoped per financial year, not per prefix. The invoice/code prefix is treated as
// fixed within a financial year; changing it mid-FY is unsupported (would share the seq sequence).
export function nextPurchaseCode(db: Database.Database, date: string): string {
  const fy = financialYear(date)
  const row = db.prepare('SELECT MAX(code_seq) AS m FROM purchases WHERE fy_label = ?').get(fy.label) as { m: number | null }
  const next = (row.m ?? 0) + 1
  return `${String(next).padStart(4, '0')}/${fy.code}`
}

function derivedAmount(input: NewPurchase): number {
  return input.rate_per_kg && input.rate_per_kg > 0
    ? round2(input.qty_kg * input.rate_per_kg)
    : round2(input.amount ?? 0)
}

function ensureHsn(db: Database.Database, hsn: string, rate: number): void {
  if (!hsn) return
  db.prepare('INSERT OR IGNORE INTO hsn_products (hsn_code, description, gst_rate) VALUES (?, ?, ?)').run(hsn, '', rate)
}

export function createPurchase(db: Database.Database, input: NewPurchase): Purchase {
  const fy = financialYear(input.invoice_date)
  const tax = computeTax({
    amount: derivedAmount(input), gstRate: input.gst_rate,
    placeOfSupplyState: input.party_state, homeState: input.homeState,
    tcs: input.tcs, roundoff: input.roundoff
  })
  ensureHsn(db, input.hsn_code, input.gst_rate)
  const info = db.prepare(`
    INSERT INTO purchases (our_code, supplier_invoice_number, invoice_date, party, party_state, hsn_code,
      party_city, party_pincode, party_address,
      qty_kg, qty_remaining_kg, rate_per_kg, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
      payment_status, payment_date, fy_label, code_seq, supplier_id)
    VALUES (@our_code, @supplier_invoice_number, @invoice_date, @party, @party_state, @hsn_code,
      @party_city, @party_pincode, @party_address,
      @qty_kg, @qty_remaining_kg, @rate_per_kg, @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount,
      @payment_status, @payment_date, @fy_label, @code_seq, @supplier_id)`).run({
    our_code: input.our_code, supplier_invoice_number: input.supplier_invoice_number,
    invoice_date: input.invoice_date, party: input.party, party_state: input.party_state,
    hsn_code: input.hsn_code,
    party_city: input.party_city ?? '', party_pincode: input.party_pincode ?? '', party_address: input.party_address ?? '',
    rate_per_kg: round2(input.rate_per_kg ?? 0),
    qty_kg: round2(input.qty_kg), qty_remaining_kg: round2(input.qty_kg),
    amount: tax.taxable_amount, cgst: tax.cgst, sgst: tax.sgst,
    igst: input.igst_manual != null ? round2(input.igst_manual) : tax.igst,
    tcs: tax.tcs, roundoff: tax.roundoff, total_invoice_amount: tax.total,
    payment_status: input.payment_status ?? 'pending', payment_date: input.payment_date ?? null,
    fy_label: fy.label, code_seq: parsePurchaseSeq(input.our_code),
    supplier_id: input.supplier_id ?? null
  })
  return getPurchase(db, Number(info.lastInsertRowid))!
}

export function getPurchase(db: Database.Database, id: number): Purchase | undefined {
  return db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as Purchase | undefined
}

export function listPurchases(db: Database.Database): Purchase[] {
  return db.prepare('SELECT * FROM purchases ORDER BY invoice_date DESC, id DESC').all() as Purchase[]
}

export function updatePurchase(db: Database.Database, id: number, input: NewPurchase): Purchase {
  const existing = getPurchase(db, id)
  if (!existing) throw new Error('Purchase not found')
  const consumed = round2(existing.qty_kg - existing.qty_remaining_kg)
  if (round2(input.qty_kg) < consumed)
    throw new Error(`Quantity cannot be below ${consumed} kg already drawn from this lot`)
  const fy = financialYear(input.invoice_date)
  const tax = computeTax({
    amount: derivedAmount(input), gstRate: input.gst_rate,
    placeOfSupplyState: input.party_state, homeState: input.homeState,
    tcs: input.tcs, roundoff: input.roundoff
  })
  ensureHsn(db, input.hsn_code, input.gst_rate)
  db.prepare(`UPDATE purchases SET our_code=@our_code, supplier_invoice_number=@sin, invoice_date=@d,
    party=@party, party_state=@ps, hsn_code=@hsn,
    party_city=@pc, party_pincode=@pp, party_address=@pa, rate_per_kg=@rpk,
    qty_kg=@qty, qty_remaining_kg=@rem, amount=@amt,
    cgst=@cgst, sgst=@sgst, igst=@igst, tcs=@tcs, roundoff=@ro, total_invoice_amount=@tot,
    payment_status=@pst, payment_date=@pd, fy_label=@fy, code_seq=@seq,
    supplier_id=@supplier_id WHERE id=@id`).run({
    id, our_code: input.our_code, sin: input.supplier_invoice_number, d: input.invoice_date,
    party: input.party, ps: input.party_state, hsn: input.hsn_code, qty: round2(input.qty_kg),
    pc: input.party_city ?? existing.party_city, pp: input.party_pincode ?? existing.party_pincode,
    pa: input.party_address ?? existing.party_address, rpk: round2(input.rate_per_kg ?? 0),
    rem: round2(round2(input.qty_kg) - consumed), amt: tax.taxable_amount, cgst: tax.cgst, sgst: tax.sgst,
    igst: input.igst_manual != null ? round2(input.igst_manual) : tax.igst, tcs: tax.tcs, ro: tax.roundoff,
    tot: tax.total, pst: input.payment_status ?? existing.payment_status, pd: input.payment_date ?? existing.payment_date,
    fy: fy.label, seq: parsePurchaseSeq(input.our_code),
    supplier_id: input.supplier_id ?? null
  })
  return getPurchase(db, id)!
}

export function deletePurchase(db: Database.Database, id: number): void {
  const used = db.prepare('SELECT COUNT(*) AS c FROM sale_allocations WHERE purchase_id = ?').get(id) as { c: number }
  if (used.c > 0) throw new Error('Cannot delete: this lot is used by one or more sales. Delete those sales first.')
  db.prepare('DELETE FROM stock_adjustments WHERE purchase_id = ?').run(id)
  db.prepare('DELETE FROM purchases WHERE id = ?').run(id)
}
