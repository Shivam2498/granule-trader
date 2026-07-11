import type Database from 'better-sqlite3'
import type { Sale, SaleAllocation } from '@shared/types'
import { computeSaleTax } from '@shared/tax'
import { round2 } from '@shared/money'
import { parseInvoiceNumber } from './invoice-number'
import { financialYear } from './financial-year'
import { reserveGaps, validateInvoiceOrder } from './invoice-validation'
import { listAvailableLots } from './available-lots'

export interface NewSaleLine {
  purchase_item_id: number; qty_drawn_kg: number; rate_per_kg: number; hsn_code: string; gst_rate: number
}
export interface NewSale {
  invoice_number: string; invoice_date: string
  buyer_customer_id: number | null; buyer_name: string; buyer_gstin: string
  buyer_billing: object; buyer_shipping: object; place_of_supply_state?: string
  homeState: string
  lines: NewSaleLine[]; roundoff?: number
  eway_bill_no?: string; eway_bill_date?: string; vehicle?: string
  payment_status?: 'pending' | 'done'; payment_date?: string | null
}

export function getSale(db: Database.Database, id: number): Sale {
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale
}
export function getAllocations(db: Database.Database, saleId: number): SaleAllocation[] {
  return db.prepare('SELECT * FROM sale_allocations WHERE sale_id = ? ORDER BY id').all(saleId) as SaleAllocation[]
}
export function listSales(db: Database.Database, fyLabel?: string): Sale[] {
  return (fyLabel
    ? db.prepare('SELECT * FROM sales WHERE fy_label = ? ORDER BY seq DESC').all(fyLabel)
    : db.prepare('SELECT * FROM sales ORDER BY fy_label DESC, seq DESC').all()) as Sale[]
}

/**
 * Identifies a sale row that writeSale should overwrite rather than insert, and the status it must
 * be in. 'reserved' = filling a gap placeholder; 'created' = editing an issued invoice.
 */
interface ExistingSale { id: number; expect: 'reserved' | 'created' }

function writeSale(db: Database.Database, input: NewSale, existing: ExistingSale | null): Sale {
  const existingId = existing?.id ?? null
  const parsed = parseInvoiceNumber(input.invoice_number)
  if (!parsed) throw new Error(`Please enter the invoice number in the format RP/008/2024-25.`)
  const { prefix, seq, fyLabel } = parsed

  // The invoice number's financial year must match the year its date falls in,
  // otherwise the sale is filed under the wrong FY and its seq ordering breaks.
  const dateFy = financialYear(input.invoice_date).label
  if (dateFy !== fyLabel)
    throw new Error(`Invoice ${input.invoice_number} is dated ${input.invoice_date}, which is in financial year ${dateFy}, not ${fyLabel}. Use an invoice number ending in ${dateFy}.`)

  // Friendly duplicate-invoice guard (the DB also enforces UNIQUE(fy_label, seq),
  // but we surface a readable message instead of the raw SqliteError).
  const dupe = db.prepare('SELECT id FROM sales WHERE fy_label = ? AND seq = ? AND id IS NOT ?')
    .get(fyLabel, seq, existingId)
  if (dupe) throw new Error(`Invoice number ${input.invoice_number} already exists.`)

  const order = validateInvoiceOrder(db, { fyLabel, seq, invoiceDate: input.invoice_date, excludeSaleId: existingId ?? undefined })
  if (!order.ok) throw new Error(order.message)

  const avail = new Map(listAvailableLots(db, input.invoice_date, { excludeSaleId: existingId ?? undefined })
    .map(l => [l.purchase_item_id, l]))
  const requestedByLot = new Map<number, number>()
  for (const line of input.lines) {
    if (round2(line.qty_drawn_kg) <= 0)
      throw new Error(`Each line needs a quantity greater than zero.`)
    const lot = avail.get(line.purchase_item_id)
    const have = lot?.available_kg ?? 0
    if (round2(line.qty_drawn_kg) > have)
      throw new Error(`Lot ${lot?.our_code ?? line.purchase_item_id} only has ${have} kg available on ${input.invoice_date}.`)
    if (lot) lot.available_kg = round2(have - round2(line.qty_drawn_kg))
    requestedByLot.set(line.purchase_item_id, round2((requestedByLot.get(line.purchase_item_id) ?? 0) + round2(line.qty_drawn_kg)))
  }

  // Physical-stock safety net: the date-scoped check above can be fooled by back-dating
  // (a later-dated sale's draw is invisible to an earlier-dated one), so also verify the
  // draw never pushes the lot's running remaining quantity below zero.
  for (const [itemId, requested] of requestedByLot) {
    const lot = db.prepare(`SELECT p.our_code, i.qty_remaining_kg FROM purchase_items i
      JOIN purchases p ON p.id = i.purchase_id WHERE i.id = ?`)
      .get(itemId) as { our_code: string; qty_remaining_kg: number } | undefined
    const remaining = round2(lot?.qty_remaining_kg ?? 0)
    if (requested > remaining)
      throw new Error(`Lot ${lot?.our_code ?? itemId} only has ${remaining} kg left in stock.`)
  }

  const tax = computeSaleTax({
    lines: input.lines.map(l => ({ qty_drawn_kg: l.qty_drawn_kg, rate_per_kg: l.rate_per_kg, gst_rate: l.gst_rate, hsn_code: l.hsn_code })),
    placeOfSupplyState: input.place_of_supply_state ?? '', homeState: input.homeState, roundoff: input.roundoff
  })

  const maxBelow = db.prepare('SELECT MAX(seq) AS m FROM sales WHERE fy_label = ? AND seq < ?').get(fyLabel, seq) as { m: number | null }
  reserveGaps(db, prefix, fyLabel, maxBelow.m ?? 0, seq)

  const fields = {
    invoice_number: input.invoice_number, prefix, seq, fy_label: fyLabel, status: 'created',
    invoice_date: input.invoice_date, eway_bill_no: input.eway_bill_no ?? null,
    eway_bill_date: input.eway_bill_date ?? null, vehicle: input.vehicle ?? null,
    buyer_customer_id: input.buyer_customer_id, buyer_name: input.buyer_name, buyer_gstin: input.buyer_gstin,
    buyer_billing_json: JSON.stringify(input.buyer_billing), buyer_shipping_json: JSON.stringify(input.buyer_shipping),
    place_of_supply_state: input.place_of_supply_state ?? '',
    amount: tax.taxable, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst,
    tcs: 0, roundoff: tax.roundoff, total_invoice_amount: tax.total, total_qty_kg: tax.totalQty,
    payment_status: input.payment_status ?? 'pending', payment_date: input.payment_date ?? null
  }

  let saleId: number
  if (existing != null) {
    const row = db.prepare('SELECT status FROM sales WHERE id = ?').get(existing.id) as { status: string } | undefined
    if (!row) throw new Error(`We couldn't find that invoice.`)
    if (row.status !== existing.expect)
      throw new Error(existing.expect === 'reserved'
        ? 'Can only fill a reserved invoice.'
        : 'That invoice number is reserved but not yet filled in. Fill it in instead of editing it.')
    db.prepare(`UPDATE sales SET invoice_number=@invoice_number, prefix=@prefix, seq=@seq, fy_label=@fy_label,
      status=@status, invoice_date=@invoice_date, eway_bill_no=@eway_bill_no, eway_bill_date=@eway_bill_date,
      vehicle=@vehicle, buyer_customer_id=@buyer_customer_id, buyer_name=@buyer_name, buyer_gstin=@buyer_gstin,
      buyer_billing_json=@buyer_billing_json, buyer_shipping_json=@buyer_shipping_json,
      place_of_supply_state=@place_of_supply_state,
      amount=@amount, cgst=@cgst, sgst=@sgst, igst=@igst, tcs=@tcs, roundoff=@roundoff,
      total_invoice_amount=@total_invoice_amount, total_qty_kg=@total_qty_kg, payment_status=@payment_status,
      payment_date=@payment_date WHERE id=@id`).run({ ...fields, id: existing.id })
    saleId = existing.id
    db.prepare('DELETE FROM sale_allocations WHERE sale_id = ?').run(saleId)
  } else {
    const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date,
      eway_bill_no, eway_bill_date, vehicle, buyer_customer_id, buyer_name, buyer_gstin, buyer_billing_json,
      buyer_shipping_json, place_of_supply_state, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
      total_qty_kg, payment_status, payment_date)
      VALUES (@invoice_number, @prefix, @seq, @fy_label, @status, @invoice_date, @eway_bill_no, @eway_bill_date,
      @vehicle, @buyer_customer_id, @buyer_name, @buyer_gstin, @buyer_billing_json, @buyer_shipping_json,
      @place_of_supply_state, @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount, @total_qty_kg,
      @payment_status, @payment_date)`).run(fields)
    saleId = Number(info.lastInsertRowid)
  }

  const insAlloc = db.prepare(`INSERT INTO sale_allocations
    (sale_id, purchase_id, purchase_item_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
  const dec = db.prepare('UPDATE purchase_items SET qty_remaining_kg = round(qty_remaining_kg - ?, 2) WHERE id = ?')
  const parentOf = db.prepare('SELECT purchase_id FROM purchase_items WHERE id = ?')
  for (const line of input.lines) {
    const parent = parentOf.get(line.purchase_item_id) as { purchase_id: number } | undefined
    if (!parent) throw new Error(`We couldn't find one of the stock lots on this sale.`)
    insAlloc.run(saleId, parent.purchase_id, line.purchase_item_id, line.hsn_code, line.gst_rate,
      round2(line.qty_drawn_kg), round2(line.rate_per_kg), round2(line.qty_drawn_kg * line.rate_per_kg))
    dec.run(round2(line.qty_drawn_kg), line.purchase_item_id)
  }
  return getSale(db, saleId)
}

export function createSale(db: Database.Database, input: NewSale): Sale {
  const tx = db.transaction(() => {
    const parsed = parseInvoiceNumber(input.invoice_number)
    const reserved = parsed
      ? db.prepare(`SELECT id FROM sales WHERE fy_label = ? AND seq = ? AND status = 'reserved'`).get(parsed.fyLabel, parsed.seq) as { id: number } | undefined
      : undefined
    return writeSale(db, input, reserved ? { id: reserved.id, expect: 'reserved' } : null)
  })
  return tx()
}

export function fillReservedSale(db: Database.Database, saleId: number, input: NewSale): Sale {
  const tx = db.transaction(() => writeSale(db, input, { id: saleId, expect: 'reserved' }))
  return tx()
}

/**
 * Edits an issued invoice. The old stock draw is handed back to its lots BEFORE the new one is
 * validated — otherwise re-saving a sale with the same lots would fail its own availability check,
 * since its existing draw would still be counted against it.
 *
 * The whole thing runs in one transaction, so a rejected edit leaves the original draw intact.
 * The invoice number is fixed: renumbering an issued invoice would break the gap-free sequence.
 */
export function updateSale(db: Database.Database, saleId: number, input: NewSale): Sale {
  const tx = db.transaction(() => {
    const current = getSale(db, saleId)
    if (!current) throw new Error(`We couldn't find that invoice.`)
    if (current.invoice_number !== input.invoice_number)
      throw new Error(`An invoice number can't be changed once it has been issued. This invoice is ${current.invoice_number}.`)

    restoreStock(db, saleId)
    db.prepare('DELETE FROM sale_allocations WHERE sale_id = ?').run(saleId)
    return writeSale(db, input, { id: saleId, expect: 'created' })
  })
  return tx()
}

export function deleteSale(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    restoreStock(db, id)
    db.prepare('DELETE FROM sales WHERE id = ?').run(id)
  })
  tx()
}

/** Hands every quantity this sale drew back to the lot it came from. Caller supplies the transaction. */
function restoreStock(db: Database.Database, saleId: number): void {
  const restore = db.prepare('UPDATE purchase_items SET qty_remaining_kg = round(qty_remaining_kg + ?, 2) WHERE id = ?')
  for (const a of getAllocations(db, saleId)) restore.run(a.qty_drawn_kg, a.purchase_item_id)
}
