import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { mkPurchase, editPurchase, lotIdOf, remainingOf } from '../helpers/purchase'
import { createSale, fillReservedSale, updateSale, listSales, deleteSale, getAllocations, getSale } from '../../src/main/core/sale'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const pbase = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }
function lot(code: string, date: string, qty: number) {
  return mkPurchase(db, { ...pbase, our_code: code, invoice_date: date, qty_kg: qty })
}
const sbase = {
  buyer_customer_id: null, buyer_name: 'Buyer', buyer_gstin: '',
  buyer_billing: {}, buyer_shipping: {}, place_of_supply_state: 'Gujarat', homeState: 'Gujarat'
}
function line(purchaseId: number, qty: number, rate: number) {
  return { purchase_item_id: lotIdOf(db, purchaseId), qty_drawn_kg: qty, rate_per_kg: rate, hsn_code: '3902', gst_rate: 18 }
}

describe('createSale', () => {
  it('draws across two lots and decrements remaining', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const b = lot('0002/2425', '2024-05-02', 1000)
    const sale = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 600, 80), line(b.id, 400, 90)] })
    expect(sale.total_qty_kg).toBe(1000)
    expect(sale.amount).toBe(84000)         // 600*80 + 400*90
    expect(sale.cgst).toBe(7560)            // 9% of 84000
    expect(remainingOf(db, a.id)).toBe(400)
    expect(remainingOf(db, b.id)).toBe(600)
  })

  it('rejects a second sale with a duplicate invoice number (friendly message)', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 100, 80)] })
    expect(() => createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-11', lines: [line(a.id, 100, 80)] }))
      .toThrow(/already exists/)
  })

  it('rejects an over-draw and rolls back everything', () => {
    const a = lot('0001/2425', '2024-05-01', 500)
    expect(() => createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 600, 80)] })).toThrow(/only has 500/)
    expect(remainingOf(db, a.id)).toBe(500)
    expect(listSales(db)).toHaveLength(0)
  })

  it('reserves skipped numbers when the seq jumps ahead', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 100, 80)] })
    const rows = listSales(db)
    expect(rows.find(s => s.seq === 1)!.status).toBe('reserved')
    expect(rows.find(s => s.seq === 2)!.status).toBe('reserved')
    expect(rows.find(s => s.seq === 3)!.status).toBe('created')
  })

  it('deleting a sale restores remaining stock', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const sale = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 300, 80)] })
    deleteSale(db, sale.id)
    expect(remainingOf(db, a.id)).toBe(1000)
  })

  it('fills a reserved row: marks it created and draws stock', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    // Create seq 3 dated 2024-05-20 -> reserves seq 1 and 2 as blank rows
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-20',
      lines: [line(a.id, 100, 80)] })
    const reserved1 = db.prepare("SELECT id FROM sales WHERE fy_label='2024-25' AND seq=1 AND status='reserved'").get() as { id: number }
    expect(reserved1).toBeTruthy()
    // Fill seq 1 with a date inside the order window (<= seq 3's 2024-05-20)
    const filled = fillReservedSale(db, reserved1.id, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-05',
      lines: [line(a.id, 200, 90)] })
    expect(filled.status).toBe('created')
    expect(filled.total_qty_kg).toBe(200)
    expect(filled.amount).toBe(18000)
    // Running remaining = 1000 - 100 (seq3) - 200 (seq1) = 700
    expect(remainingOf(db, a.id)).toBe(700)
  })

  it('stores HSN + gst_rate on each allocation', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 100, 80)] })
    const allocs = getAllocations(db, s.id)
    expect(allocs[0].hsn_code).toBe('3902')
    expect(allocs[0].gst_rate).toBe(18)
  })

  it('keeps a 4-decimal selling rate, so re-opening the sale reproduces the same amount', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 500, 147.5425)] })
    const [alloc] = getAllocations(db, s.id)
    expect(alloc.rate_per_kg).toBe(147.5425)
    expect(alloc.line_amount).toBe(73771.25)
    expect(s.amount).toBe(73771.25)
  })

  it('rejects duplicate purchase_id lines that together exceed available stock', () => {
    const a = lot('0001/2425', '2024-05-01', 500)
    // Two lines on the same lot, 400kg each — together they exceed 500kg
    expect(() => createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 400, 80), line(a.id, 400, 80)] })).toThrow(/only has/)
    // Remaining must be unchanged (transaction rolled back)
    expect((db.prepare('SELECT qty_remaining_kg FROM purchase_items WHERE purchase_id = ?').get(a.id) as any).qty_remaining_kg).toBe(500)
    expect(listSales(db)).toHaveLength(0)
  })

  it('fillReservedSale throws when the target sale is not reserved', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const created = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 100, 80)] })
    expect(() => fillReservedSale(db, created.id, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 50, 80)] })).toThrow(/Can only fill a reserved invoice/)
  })

  it('rejects a back-dated reserved fill that would oversell the lot (never goes negative)', () => {
    const a = lot('0001/2425', '2024-05-01', 100)
    // seq 3 dated later draws the whole lot; reserves seq 1 and 2
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-20',
      lines: [line(a.id, 100, 80)] })
    const reserved1 = db.prepare("SELECT id FROM sales WHERE fy_label='2024-25' AND seq=1 AND status='reserved'").get() as { id: number }
    // Back-date seq 1 before seq 3 and try to draw another 100kg — the date-scoped
    // view sees 0 sold, but the lot physically has 0 left. Must be rejected.
    expect(() => fillReservedSale(db, reserved1.id, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-05',
      lines: [line(a.id, 100, 90)] })).toThrow(/left in stock/)
    expect(remainingOf(db, a.id)).toBe(0)
  })

  it('rejects an invoice number whose FY does not match the invoice date', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    // Dated in FY 2025-26 but numbered under 2024-25
    expect(() => createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2025-05-01',
      lines: [line(a.id, 100, 80)] })).toThrow(/financial year 2025-26/)
    expect(listSales(db)).toHaveLength(0)
  })

  it('rejects a line with zero or negative quantity', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    expect(() => createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, -50, 80)] })).toThrow(/greater than zero/)
    expect(remainingOf(db, a.id)).toBe(1000)
    expect(listSales(db)).toHaveLength(0)
  })

  it('persists place_of_supply_state and getSale returns it', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const sale = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      place_of_supply_state: 'Maharashtra', lines: [line(a.id, 100, 80)] })
    const fetched = getSale(db, sale.id)
    expect(fetched.place_of_supply_state).toBe('Maharashtra')
  })

  it('defaults place_of_supply_state to empty string when omitted', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const { place_of_supply_state: _pos, ...sbaseNoPos } = sbase
    const sale = createSale(db, { ...sbaseNoPos, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [line(a.id, 100, 80)] })
    const fetched = getSale(db, sale.id)
    expect(fetched.place_of_supply_state).toBe('')
  })
})

describe('listSales FY filter', () => {
  it('filters by fy_label and returns all when omitted', () => {
    db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date) VALUES ('RP/1','RP',1,'2024-25','created','2024-05-10')`).run()
    db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date) VALUES ('RP/1','RP',1,'2025-26','created','2025-05-10')`).run()
    expect(listSales(db).length).toBeGreaterThanOrEqual(2)
    expect(listSales(db, '2024-25').every(s => s.fy_label === '2024-25')).toBe(true)
    expect(listSales(db, '2024-25')).toHaveLength(1)
  })
})

describe('updateSale', () => {
  const base = (lines: any[]) => ({
    ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10', lines
  })

  it('re-saves an unchanged sale without tripping its own availability check', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, base([line(a.id, 600, 80)]))
    // The old draw must be returned BEFORE the new one is validated, or the sale's own 600 kg
    // would still be counted against it and a no-op edit would fail.
    expect(() => updateSale(db, s.id, base([line(a.id, 600, 80)]))).not.toThrow()
    expect(remainingOf(db, a.id)).toBe(400)
  })

  it('returns stock to the old lot and draws from the new one', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const b = lot('0002/2425', '2024-05-02', 1000)
    const s = createSale(db, base([line(a.id, 600, 80)]))
    expect(remainingOf(db, a.id)).toBe(400)

    updateSale(db, s.id, base([line(b.id, 250, 95)]))
    expect(remainingOf(db, a.id)).toBe(1000)   // fully restored
    expect(remainingOf(db, b.id)).toBe(750)
  })

  it('recomputes the totals from the new lines', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, base([line(a.id, 600, 80)]))
    const updated = updateSale(db, s.id, base([line(a.id, 100, 50)]))
    expect(updated.amount).toBe(5000)
    expect(updated.total_qty_kg).toBe(100)
    expect(updated.cgst).toBe(450)             // 9% of 5000
    expect(getAllocations(db, s.id)).toHaveLength(1)
  })

  it('rolls back completely when the new lines are not valid', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const b = lot('0002/2425', '2024-05-02', 100)
    const s = createSale(db, base([line(a.id, 600, 80)]))

    expect(() => updateSale(db, s.id, base([line(b.id, 999, 80)]))).toThrow(/only has/)
    // the original draw survives untouched — no stock was left floating
    expect(remainingOf(db, a.id)).toBe(400)
    expect(remainingOf(db, b.id)).toBe(100)
    expect(getAllocations(db, s.id)).toHaveLength(1)
    expect(getSale(db, s.id).total_qty_kg).toBe(600)
  })

  it('refuses to renumber an issued invoice', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, base([line(a.id, 100, 80)]))
    expect(() => updateSale(db, s.id, { ...base([line(a.id, 100, 80)]), invoice_number: 'RP/009/2024-25' }))
      .toThrow(/can't be changed once it has been issued/)
  })

  it('can change the buyer and the date', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, base([line(a.id, 100, 80)]))
    const updated = updateSale(db, s.id, {
      ...base([line(a.id, 100, 80)]), buyer_name: 'New Buyer', invoice_date: '2024-05-20'
    })
    expect(updated.buyer_name).toBe('New Buyer')
    expect(updated.invoice_date).toBe('2024-05-20')
  })

  it('will not edit a reserved invoice — it must be filled instead', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 100, 80)] })
    const reserved = listSales(db).find(x => x.status === 'reserved')!
    expect(() => updateSale(db, reserved.id, {
      ...sbase, invoice_number: reserved.invoice_number, invoice_date: '2024-05-10', lines: [line(a.id, 50, 80)]
    })).toThrow(/Fill it in instead/)
  })
})
