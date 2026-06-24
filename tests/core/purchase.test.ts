import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { nextPurchaseCode, createPurchase, listPurchases, deletePurchase } from '../../src/main/core/purchase'

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
})
