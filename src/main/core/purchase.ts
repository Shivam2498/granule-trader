import type Database from 'better-sqlite3'
import type { Purchase, PurchaseItem } from '@shared/types'
import { computePurchaseTax, lineAmount } from '@shared/tax'
import { financialYear } from './financial-year'
import { round2 } from './money'

/**
 * One line of the purchase. `id` is present only when editing an existing line — a line without
 * an id is new. Each line becomes a stock lot.
 */
export interface NewPurchaseItem {
  id?: number
  hsn_code: string
  description?: string
  qty_kg: number
  rate_per_kg?: number
  amount?: number
  gst_rate: number
}

export interface NewPurchase {
  our_code: string; supplier_invoice_number: string; invoice_date: string
  party: string; party_state: string
  party_city?: string; party_pincode?: string; party_address?: string
  homeState: string
  items: NewPurchaseItem[]
  igst_manual?: number; tcs?: number; roundoff?: number
  payment_status?: 'pending' | 'done'; payment_date?: string | null
  eway_bill_no?: string; eway_bill_date?: string; vehicle?: string
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

/**
 * Stock lives on purchase_items, so the qty columns on the purchases row would go stale the moment
 * anything is sold. Every read recomputes them from the items — a caller can never see a stale
 * remaining quantity, whatever is physically stored on the row.
 */
const PURCHASE_SELECT = `
  SELECT p.*,
    COALESCE((SELECT SUM(i.qty_kg) FROM purchase_items i WHERE i.purchase_id = p.id), p.qty_kg) AS qty_kg,
    COALESCE((SELECT SUM(i.qty_remaining_kg) FROM purchase_items i WHERE i.purchase_id = p.id), p.qty_remaining_kg) AS qty_remaining_kg
  FROM purchases p`

export function getPurchase(db: Database.Database, id: number): Purchase | undefined {
  return db.prepare(`${PURCHASE_SELECT} WHERE p.id = ?`).get(id) as Purchase | undefined
}

export function getPurchaseItems(db: Database.Database, purchaseId: number): PurchaseItem[] {
  return db.prepare('SELECT * FROM purchase_items WHERE purchase_id = ? ORDER BY line_no, id').all(purchaseId) as PurchaseItem[]
}

export function listPurchases(db: Database.Database, fyLabel?: string): Purchase[] {
  return (fyLabel
    ? db.prepare(`${PURCHASE_SELECT} WHERE p.fy_label = ? ORDER BY p.invoice_date DESC, p.id DESC`).all(fyLabel)
    : db.prepare(`${PURCHASE_SELECT} ORDER BY p.invoice_date DESC, p.id DESC`).all()) as Purchase[]
}

function ensureHsn(db: Database.Database, hsn: string, rate: number): void {
  if (!hsn) return
  db.prepare('INSERT OR IGNORE INTO hsn_products (hsn_code, description, gst_rate) VALUES (?, ?, ?)').run(hsn, '', rate)
}

function validateItems(items: NewPurchaseItem[]): void {
  if (!items || items.length === 0) throw new Error('Add at least one item to this purchase.')
  for (const it of items) {
    if (!it.hsn_code?.trim()) throw new Error('Every item needs an HSN code.')
    if (round2(it.qty_kg) <= 0) throw new Error(`Item ${it.hsn_code} needs a quantity greater than zero.`)
  }
}

function taxFor(db: Database.Database, input: NewPurchase) {
  return computePurchaseTax({
    lines: input.items.map(i => ({
      qty_kg: i.qty_kg, rate_per_kg: i.rate_per_kg, amount: i.amount, gst_rate: i.gst_rate, hsn_code: i.hsn_code
    })),
    placeOfSupplyState: input.party_state, homeState: input.homeState,
    tcs: input.tcs, roundoff: input.roundoff, igstManual: input.igst_manual ?? null
  })
}

/**
 * The per-line columns on `purchases` (hsn_code, qty_kg, ...) mirror the FIRST line. They are no
 * longer the source of truth for stock — purchase_items is — but reports, the CSV importer and the
 * purchases list still read them, so they are kept consistent rather than dropped.
 */
function headerMirror(items: NewPurchaseItem[], totalQty: number) {
  const first = items[0]
  return {
    hsn_code: first.hsn_code,
    description: first.description ?? '',
    qty_kg: round2(totalQty),
    qty_remaining_kg: round2(totalQty),
    rate_per_kg: round2(first.rate_per_kg ?? 0)
  }
}

export function createPurchase(db: Database.Database, input: NewPurchase): Purchase {
  validateItems(input.items)
  const fy = financialYear(input.invoice_date)
  if (db.prepare('SELECT id FROM purchases WHERE fy_label = ? AND code_seq = ?').get(fy.label, parsePurchaseSeq(input.our_code)))
    throw new Error(`Purchase code ${input.our_code} already exists.`)

  const tax = taxFor(db, input)
  const mirror = headerMirror(input.items, tax.totalQty)

  const tx = db.transaction(() => {
    const info = db.prepare(`
      INSERT INTO purchases (our_code, supplier_invoice_number, invoice_date, party, party_state, hsn_code,
        description, party_city, party_pincode, party_address,
        qty_kg, qty_remaining_kg, rate_per_kg, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
        payment_status, payment_date, eway_bill_no, eway_bill_date, vehicle, fy_label, code_seq, supplier_id)
      VALUES (@our_code, @supplier_invoice_number, @invoice_date, @party, @party_state, @hsn_code,
        @description, @party_city, @party_pincode, @party_address,
        @qty_kg, @qty_remaining_kg, @rate_per_kg, @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount,
        @payment_status, @payment_date, @eway_bill_no, @eway_bill_date, @vehicle, @fy_label, @code_seq, @supplier_id)`).run({
      our_code: input.our_code, supplier_invoice_number: input.supplier_invoice_number,
      invoice_date: input.invoice_date, party: input.party, party_state: input.party_state,
      party_city: input.party_city ?? '', party_pincode: input.party_pincode ?? '', party_address: input.party_address ?? '',
      ...mirror,
      amount: tax.taxable_amount, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst,
      tcs: tax.tcs, roundoff: tax.roundoff, total_invoice_amount: tax.total,
      payment_status: input.payment_status ?? 'pending', payment_date: input.payment_date ?? null,
      eway_bill_no: input.eway_bill_no ?? '', eway_bill_date: input.eway_bill_date ?? '', vehicle: input.vehicle ?? '',
      fy_label: fy.label, code_seq: parsePurchaseSeq(input.our_code),
      supplier_id: input.supplier_id ?? null
    })
    const purchaseId = Number(info.lastInsertRowid)
    const ins = db.prepare(`INSERT INTO purchase_items
      (purchase_id, hsn_code, description, qty_kg, qty_remaining_kg, rate_per_kg, amount, gst_rate, line_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    input.items.forEach((it, i) => {
      ensureHsn(db, it.hsn_code, it.gst_rate)
      const qty = round2(it.qty_kg)
      ins.run(purchaseId, it.hsn_code, it.description ?? '', qty, qty,
        round2(it.rate_per_kg ?? 0), lineAmount({ ...it, qty_kg: qty }), it.gst_rate, i + 1)
    })
    return purchaseId
  })
  return getPurchase(db, tx())!
}

export function updatePurchase(db: Database.Database, id: number, input: NewPurchase): Purchase {
  validateItems(input.items)
  const existing = getPurchase(db, id)
  if (!existing) throw new Error(`We couldn't find that purchase.`)

  const fy = financialYear(input.invoice_date)
  if (db.prepare('SELECT id FROM purchases WHERE fy_label = ? AND code_seq = ? AND id <> ?').get(fy.label, parsePurchaseSeq(input.our_code), id))
    throw new Error(`Purchase code ${input.our_code} already exists.`)

  const current = getPurchaseItems(db, id)
  const byId = new Map(current.map(i => [i.id, i]))
  const keptIds = new Set(input.items.map(i => i.id).filter((x): x is number => x != null))

  // A line that has been sold or written off cannot vanish — its stock is already committed.
  for (const item of current) {
    if (keptIds.has(item.id)) continue
    const consumed = round2(item.qty_kg - item.qty_remaining_kg)
    if (consumed > 0)
      throw new Error(`${consumed} kg of ${item.hsn_code} has already been sold from this purchase, so that item can't be removed.`)
  }

  const tax = taxFor(db, input)
  const mirror = headerMirror(input.items, tax.totalQty)

  const tx = db.transaction(() => {
    db.prepare(`UPDATE purchases SET our_code=@our_code, supplier_invoice_number=@sin, invoice_date=@d,
      party=@party, party_state=@ps, hsn_code=@hsn_code, description=@description,
      party_city=@pc, party_pincode=@pp, party_address=@pa, rate_per_kg=@rate_per_kg,
      qty_kg=@qty_kg, qty_remaining_kg=@qty_remaining_kg, amount=@amt,
      cgst=@cgst, sgst=@sgst, igst=@igst, tcs=@tcs, roundoff=@ro, total_invoice_amount=@tot,
      payment_status=@pst, payment_date=@pd, eway_bill_no=@eway_bill_no, eway_bill_date=@eway_bill_date,
      vehicle=@vehicle, fy_label=@fy, code_seq=@seq,
      supplier_id=@supplier_id WHERE id=@id`).run({
      id, our_code: input.our_code, sin: input.supplier_invoice_number, d: input.invoice_date,
      party: input.party, ps: input.party_state,
      pc: input.party_city ?? existing.party_city, pp: input.party_pincode ?? existing.party_pincode,
      pa: input.party_address ?? existing.party_address,
      ...mirror,
      amt: tax.taxable_amount, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst,
      tcs: tax.tcs, ro: tax.roundoff, tot: tax.total,
      pst: input.payment_status ?? existing.payment_status, pd: input.payment_date ?? existing.payment_date,
      eway_bill_no: input.eway_bill_no ?? existing.eway_bill_no,
      eway_bill_date: input.eway_bill_date ?? existing.eway_bill_date,
      vehicle: input.vehicle ?? existing.vehicle,
      fy: fy.label, seq: parsePurchaseSeq(input.our_code),
      supplier_id: input.supplier_id ?? existing.supplier_id
    })

    for (const item of current) if (!keptIds.has(item.id)) db.prepare('DELETE FROM purchase_items WHERE id = ?').run(item.id)

    const ins = db.prepare(`INSERT INTO purchase_items
      (purchase_id, hsn_code, description, qty_kg, qty_remaining_kg, rate_per_kg, amount, gst_rate, line_no)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const upd = db.prepare(`UPDATE purchase_items SET hsn_code=?, description=?, qty_kg=?, qty_remaining_kg=?,
      rate_per_kg=?, amount=?, gst_rate=?, line_no=? WHERE id=?`)

    input.items.forEach((it, i) => {
      ensureHsn(db, it.hsn_code, it.gst_rate)
      const qty = round2(it.qty_kg)
      const amt = lineAmount({ ...it, qty_kg: qty })
      const prev = it.id != null ? byId.get(it.id) : undefined
      if (prev) {
        // Keep what has already left the lot; only the unsold remainder can change.
        const consumed = round2(prev.qty_kg - prev.qty_remaining_kg)
        if (qty < consumed)
          throw new Error(`You've already sold ${consumed} kg of ${prev.hsn_code} from this purchase, so its quantity can't be less than that.`)
        upd.run(it.hsn_code, it.description ?? '', qty, round2(qty - consumed),
          round2(it.rate_per_kg ?? 0), amt, it.gst_rate, i + 1, it.id)
      } else {
        ins.run(id, it.hsn_code, it.description ?? '', qty, qty,
          round2(it.rate_per_kg ?? 0), amt, it.gst_rate, i + 1)
      }
    })
  })
  tx()
  return getPurchase(db, id)!
}

export function deletePurchase(db: Database.Database, id: number): void {
  const used = db.prepare('SELECT COUNT(*) AS c FROM sale_allocations WHERE purchase_id = ?').get(id) as { c: number }
  if (used.c > 0) throw new Error('This lot is used in one or more sales. Please delete those sales first.')
  const tx = db.transaction(() => {
    db.prepare('DELETE FROM stock_adjustments WHERE purchase_id = ?').run(id)
    db.prepare('DELETE FROM purchase_items WHERE purchase_id = ?').run(id)
    db.prepare('DELETE FROM purchases WHERE id = ?').run(id)
  })
  tx()
}
