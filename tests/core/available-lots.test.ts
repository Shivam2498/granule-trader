import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase } from '../../src/main/core/purchase'
import { mkPurchase, editPurchase, lotIdOf, remainingOf } from '../helpers/purchase'
import { listAvailableLots } from '../../src/main/core/available-lots'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const base = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }

function sale(date: string, purchaseId: number, qty: number) {
  const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
    VALUES ('RP/x', 'RP', 1, '2024-25', 'created', ?)`).run(date)
  db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, purchase_item_id, qty_drawn_kg, rate_per_kg, line_amount)
    VALUES (?, ?, ?, ?, 1, ?)`).run(info.lastInsertRowid, purchaseId, lotIdOf(db, purchaseId), qty, qty)
}

describe('listAvailableLots', () => {
  it('excludes lots purchased after the as-of date', () => {
    mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-06-01', qty_kg: 500 })
    expect(listAvailableLots(db, '2024-05-01')).toHaveLength(0)
    expect(listAvailableLots(db, '2024-06-01')).toHaveLength(1)
  })
  it('subtracts only sales dated on or before the as-of date', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    sale('2024-07-01', p.id, 400)            // future relative to as-of
    expect(listAvailableLots(db, '2024-06-01')[0].available_kg).toBe(1000)
    expect(listAvailableLots(db, '2024-08-01')[0].available_kg).toBe(600)
  })
  it('drops lots with zero available', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 100 })
    sale('2024-05-02', p.id, 100)
    expect(listAvailableLots(db, '2024-06-01')).toHaveLength(0)
  })
  it('excludes a given sale\'s own allocations when excludeSaleId is set', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
      VALUES ('RP/001/2024-25','RP',1,'2024-25','created','2024-05-10')`).run()
    db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, purchase_item_id, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (?, ?, ?, 300, 1, 300)`).run(info.lastInsertRowid, p.id, lotIdOf(db, p.id))
    // normal view subtracts the 300
    expect(listAvailableLots(db, '2024-06-01')[0].available_kg).toBe(700)
    // excluding that sale's id makes the full lot available again
    expect(listAvailableLots(db, '2024-06-01', { excludeSaleId: Number(info.lastInsertRowid) })[0].available_kg).toBe(1000)
  })
  it('subtracts stock adjustments dated on or before the as-of date', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    db.prepare(`INSERT INTO stock_adjustments (purchase_id, purchase_item_id, qty_kg, reason, date)
      VALUES (?, ?, 150, 'spillage', '2024-07-01')`).run(p.id, lotIdOf(db, p.id))
    expect(listAvailableLots(db, '2024-06-01')[0].available_kg).toBe(1000)  // adjustment is in the future
    expect(listAvailableLots(db, '2024-08-01')[0].available_kg).toBe(850)   // now counted
  })
})
