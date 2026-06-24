import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { createSale, fillReservedSale, listSales, deleteSale } from '../../src/main/core/sale'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const pbase = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }
function lot(code: string, date: string, qty: number) {
  return createPurchase(db, { ...pbase, our_code: code, invoice_date: date, qty_kg: qty })
}
const sbase = {
  buyer_customer_id: null, buyer_name: 'Buyer', buyer_gstin: '',
  buyer_billing: {}, buyer_shipping: {}, place_of_supply_state: 'Gujarat',
  homeState: 'Gujarat', hsn_code: '3902', gst_rate: 18
}

describe('createSale', () => {
  it('draws across two lots and decrements remaining', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const b = lot('0002/2425', '2024-05-02', 1000)
    const sale = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 600, rate_per_kg: 80 }, { purchase_id: b.id, qty_drawn_kg: 400, rate_per_kg: 90 }] })
    expect(sale.total_qty_kg).toBe(1000)
    expect(sale.amount).toBe(84000)         // 600*80 + 400*90
    expect(sale.cgst).toBe(7560)            // 9% of 84000
    expect(getPurchase(db, a.id)!.qty_remaining_kg).toBe(400)
    expect(getPurchase(db, b.id)!.qty_remaining_kg).toBe(600)
  })

  it('rejects an over-draw and rolls back everything', () => {
    const a = lot('0001/2425', '2024-05-01', 500)
    expect(() => createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 600, rate_per_kg: 80 }] })).toThrow(/only has 500/)
    expect(getPurchase(db, a.id)!.qty_remaining_kg).toBe(500)
    expect(listSales(db)).toHaveLength(0)
  })

  it('reserves skipped numbers when the seq jumps ahead', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 100, rate_per_kg: 80 }] })
    const rows = listSales(db)
    expect(rows.find(s => s.seq === 1)!.status).toBe('reserved')
    expect(rows.find(s => s.seq === 2)!.status).toBe('reserved')
    expect(rows.find(s => s.seq === 3)!.status).toBe('created')
  })

  it('deleting a sale restores remaining stock', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const sale = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 300, rate_per_kg: 80 }] })
    deleteSale(db, sale.id)
    expect(getPurchase(db, a.id)!.qty_remaining_kg).toBe(1000)
  })

  it('fills a reserved row: marks it created and draws stock', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    // Create seq 3 dated 2024-05-20 -> reserves seq 1 and 2 as blank rows
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-20',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 100, rate_per_kg: 80 }] })
    const reserved1 = db.prepare("SELECT id FROM sales WHERE fy_label='2024-25' AND seq=1 AND status='reserved'").get() as { id: number }
    expect(reserved1).toBeTruthy()
    // Fill seq 1 with a date inside the order window (<= seq 3's 2024-05-20)
    const filled = fillReservedSale(db, reserved1.id, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-05',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 200, rate_per_kg: 90 }] })
    expect(filled.status).toBe('created')
    expect(filled.total_qty_kg).toBe(200)
    expect(filled.amount).toBe(18000)
    // Running remaining = 1000 - 100 (seq3) - 200 (seq1) = 700
    expect(getPurchase(db, a.id)!.qty_remaining_kg).toBe(700)
  })
})
