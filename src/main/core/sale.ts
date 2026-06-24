import type Database from 'better-sqlite3'
import type { Sale, SaleAllocation } from '@shared/types'
import { computeSaleTax } from '@shared/tax'
import { round2 } from '@shared/money'
import { parseInvoiceNumber } from './invoice-number'
import { reserveGaps, validateInvoiceOrder } from './invoice-validation'
import { listAvailableLots } from './available-lots'

export interface NewSaleLine {
  purchase_id: number; qty_drawn_kg: number; rate_per_kg: number; hsn_code: string; gst_rate: number
}
export interface NewSale {
  invoice_number: string; invoice_date: string
  buyer_customer_id: number | null; buyer_name: string; buyer_gstin: string
  buyer_billing: object; buyer_shipping: object; place_of_supply_state: string
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
export function listSales(db: Database.Database): Sale[] {
  return db.prepare(`SELECT * FROM sales ORDER BY fy_label DESC, seq DESC`).all() as Sale[]
}

function writeSale(db: Database.Database, input: NewSale, existingReservedId: number | null): Sale {
  const parsed = parseInvoiceNumber(input.invoice_number)
  if (!parsed) throw new Error(`Invoice number must look like RP/008/2024-25 (got "${input.invoice_number}")`)
  const { prefix, seq, fyLabel } = parsed

  const order = validateInvoiceOrder(db, { fyLabel, seq, invoiceDate: input.invoice_date, excludeSaleId: existingReservedId ?? undefined })
  if (!order.ok) throw new Error(order.message)

  const avail = new Map(listAvailableLots(db, input.invoice_date, { excludeSaleId: existingReservedId ?? undefined })
    .map(l => [l.purchase_id, l]))
  for (const line of input.lines) {
    const lot = avail.get(line.purchase_id)
    const have = lot?.available_kg ?? 0
    if (round2(line.qty_drawn_kg) > have)
      throw new Error(`Lot ${lot?.our_code ?? line.purchase_id} only has ${have} kg left as of ${input.invoice_date}`)
  }

  const tax = computeSaleTax({
    lines: input.lines.map(l => ({ qty_drawn_kg: l.qty_drawn_kg, rate_per_kg: l.rate_per_kg, gst_rate: l.gst_rate })),
    placeOfSupplyState: input.place_of_supply_state, homeState: input.homeState, roundoff: input.roundoff
  })

  const maxBelow = db.prepare('SELECT MAX(seq) AS m FROM sales WHERE fy_label = ? AND seq < ?').get(fyLabel, seq) as { m: number | null }
  reserveGaps(db, prefix, fyLabel, maxBelow.m ?? 0, seq)

  const fields = {
    invoice_number: input.invoice_number, prefix, seq, fy_label: fyLabel, status: 'created',
    invoice_date: input.invoice_date, eway_bill_no: input.eway_bill_no ?? null,
    eway_bill_date: input.eway_bill_date ?? null, vehicle: input.vehicle ?? null,
    buyer_customer_id: input.buyer_customer_id, buyer_name: input.buyer_name, buyer_gstin: input.buyer_gstin,
    buyer_billing_json: JSON.stringify(input.buyer_billing), buyer_shipping_json: JSON.stringify(input.buyer_shipping),
    amount: tax.taxable, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst,
    tcs: 0, roundoff: tax.roundoff, total_invoice_amount: tax.total, total_qty_kg: tax.totalQty,
    payment_status: input.payment_status ?? 'pending', payment_date: input.payment_date ?? null
  }

  let saleId: number
  if (existingReservedId != null) {
    db.prepare(`UPDATE sales SET invoice_number=@invoice_number, prefix=@prefix, seq=@seq, fy_label=@fy_label,
      status=@status, invoice_date=@invoice_date, eway_bill_no=@eway_bill_no, eway_bill_date=@eway_bill_date,
      vehicle=@vehicle, buyer_customer_id=@buyer_customer_id, buyer_name=@buyer_name, buyer_gstin=@buyer_gstin,
      buyer_billing_json=@buyer_billing_json, buyer_shipping_json=@buyer_shipping_json,
      amount=@amount, cgst=@cgst, sgst=@sgst, igst=@igst, tcs=@tcs, roundoff=@roundoff,
      total_invoice_amount=@total_invoice_amount, total_qty_kg=@total_qty_kg, payment_status=@payment_status,
      payment_date=@payment_date WHERE id=@id`).run({ ...fields, id: existingReservedId })
    saleId = existingReservedId
    db.prepare('DELETE FROM sale_allocations WHERE sale_id = ?').run(saleId)
  } else {
    const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date,
      eway_bill_no, eway_bill_date, vehicle, buyer_customer_id, buyer_name, buyer_gstin, buyer_billing_json,
      buyer_shipping_json, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
      total_qty_kg, payment_status, payment_date)
      VALUES (@invoice_number, @prefix, @seq, @fy_label, @status, @invoice_date, @eway_bill_no, @eway_bill_date,
      @vehicle, @buyer_customer_id, @buyer_name, @buyer_gstin, @buyer_billing_json, @buyer_shipping_json,
      @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount, @total_qty_kg,
      @payment_status, @payment_date)`).run(fields)
    saleId = Number(info.lastInsertRowid)
  }

  const insAlloc = db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const dec = db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg - ?, 2) WHERE id = ?')
  for (const line of input.lines) {
    insAlloc.run(saleId, line.purchase_id, line.hsn_code, line.gst_rate, round2(line.qty_drawn_kg), round2(line.rate_per_kg), round2(line.qty_drawn_kg * line.rate_per_kg))
    dec.run(round2(line.qty_drawn_kg), line.purchase_id)
  }
  return getSale(db, saleId)
}

export function createSale(db: Database.Database, input: NewSale): Sale {
  const tx = db.transaction(() => {
    const parsed = parseInvoiceNumber(input.invoice_number)
    const reserved = parsed
      ? db.prepare(`SELECT id FROM sales WHERE fy_label = ? AND seq = ? AND status = 'reserved'`).get(parsed.fyLabel, parsed.seq) as { id: number } | undefined
      : undefined
    return writeSale(db, input, reserved?.id ?? null)
  })
  return tx()
}

export function fillReservedSale(db: Database.Database, saleId: number, input: NewSale): Sale {
  const tx = db.transaction(() => writeSale(db, input, saleId))
  return tx()
}

export function deleteSale(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    const allocs = getAllocations(db, id)
    const restore = db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg + ?, 2) WHERE id = ?')
    for (const a of allocs) restore.run(a.qty_drawn_kg, a.purchase_id)
    db.prepare('DELETE FROM sales WHERE id = ?').run(id)
  })
  tx()
}
