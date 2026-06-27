import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { nextPurchaseCode, createPurchase, listPurchases, deletePurchase, updatePurchase } from '../../src/main/core/purchase'
import { createSupplier } from '../../src/main/core/suppliers'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const base = {
  supplier_invoice_number: 'S-1', party: 'Acme', party_state: 'Gujarat',
  hsn_code: '3902', qty_kg: 1000, amount: 50000, gst_rate: 18, homeState: 'Gujarat'
}

describe('nextPurchaseCode', () => {
  it('starts at 0001 for an empty FY', () => {
    expect(nextPurchaseCode(db, '2024-05-01')).toBe('0001/2425')
  })
  it('increments within the FY and resets next FY', () => {
    createPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2024-05-01'), invoice_date: '2024-05-01' })
    expect(nextPurchaseCode(db, '2024-06-01')).toBe('0002/2425')
    expect(nextPurchaseCode(db, '2025-04-02')).toBe('0001/2526')
  })
})

describe('createPurchase', () => {
  it('sets remaining = qty and computes intra-state tax', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(p.qty_remaining_kg).toBe(1000)
    expect(p.cgst).toBe(4500)
    expect(p.sgst).toBe(4500)
    expect(p.total_invoice_amount).toBe(59000)
  })
})

describe('deletePurchase', () => {
  it('lists then deletes a purchase with no allocations', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(listPurchases(db)).toHaveLength(1)
    deletePurchase(db, p.id)
    expect(listPurchases(db)).toHaveLength(0)
  })
  it('blocks deletion when allocations reference the lot', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
      VALUES ('RP/001/2024-25','RP',1,'2024-25','created','2024-05-10')`).run()
    db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (?, ?, 100, 80, 8000)`).run(info.lastInsertRowid, p.id)
    expect(() => deletePurchase(db, p.id)).toThrow(/used in one or more sales/)
    expect(listPurchases(db)).toHaveLength(1)
  })
})

describe('updatePurchase', () => {
  it('rejects qty below already-drawn', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    db.prepare('UPDATE purchases SET qty_remaining_kg = 400 WHERE id = ?').run(p.id)
    expect(() => updatePurchase(db, p.id, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 500 }))
      .toThrow(/already sold 600/)
  })
})

describe('rate-driven amount', () => {
  it('derives amount from quantity x rate and stores rate + address', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01',
      qty_kg: 1000, rate_per_kg: 50, party_city: 'Surat', party_pincode: '395003', party_address: 'GIDC' })
    expect(p.amount).toBe(50000)            // 1000 * 50
    expect(p.rate_per_kg).toBe(50)
    expect(p.party_city).toBe('Surat')
    expect(p.cgst).toBe(4500)               // 9% of 50000 intra-state
    expect(p.total_invoice_amount).toBe(59000)
  })
})

describe('purchase supplier link', () => {
  it('stores and returns supplier_id', () => {
    const sup = createSupplier(db, {
      name: 'Acme Polymers', gstin: '24CCGPC8555A1Z5', pan: 'CCGPC8555A', phone: '9876543210',
      address: '1 Estate', city: 'Surat', state: 'Gujarat', pincode: '395003'
    })
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', supplier_id: sup.id })
    expect(p.supplier_id).toBe(sup.id)
    expect(listPurchases(db)[0].supplier_id).toBe(sup.id)
  })
  it('defaults supplier_id to null when omitted', () => {
    const p = createPurchase(db, { ...base, our_code: '0002/2425', invoice_date: '2024-05-01' })
    expect(p.supplier_id).toBeNull()
  })
})

describe('duplicate purchase code', () => {
  it('rejects a second purchase with the same code in the same FY', () => {
    createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(() => createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-06-01' }))
      .toThrow(/already exists/)
  })
  it('updatePurchase rejects colliding with another code but allows keeping its own', () => {
    const a = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    const b = createPurchase(db, { ...base, our_code: '0002/2425', invoice_date: '2024-05-02' })
    expect(() => updatePurchase(db, b.id, { ...base, our_code: '0001/2425', invoice_date: '2024-05-02', qty_kg: 1000 }))
      .toThrow(/already exists/)
    expect(() => updatePurchase(db, a.id, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })).not.toThrow()
  })
})

describe('listPurchases FY filter', () => {
  it('filters by fy_label and returns all when omitted', () => {
    createPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2024-05-01'), invoice_date: '2024-05-01' })
    createPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2025-06-01'), invoice_date: '2025-06-01' })
    expect(listPurchases(db)).toHaveLength(2)
    expect(listPurchases(db, '2024-25')).toHaveLength(1)
    expect(listPurchases(db, '2024-25')[0].fy_label).toBe('2024-25')
    expect(listPurchases(db, '2099-00')).toHaveLength(0)
  })
})
