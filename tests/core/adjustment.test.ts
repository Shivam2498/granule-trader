import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { createStockAdjustment, stockLedger } from '../../src/main/core/adjustment'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })
const pbase = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }

describe('createStockAdjustment', () => {
  it('reduces remaining by the adjusted amount', () => {
    const p = createPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_id: p.id, qty_kg: 50, reason: 'spillage', date: '2024-05-05' })
    expect(getPurchase(db, p.id)!.qty_remaining_kg).toBe(950)
  })
  it('rejects an adjustment larger than remaining', () => {
    const p = createPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 100 })
    expect(() => createStockAdjustment(db, { purchase_id: p.id, qty_kg: 150, reason: 'x', date: '2024-05-05' })).toThrow(/only has 100/)
    expect(getPurchase(db, p.id)!.qty_remaining_kg).toBe(100)
  })
})

describe('stockLedger', () => {
  it('lists lots with positive balance', () => {
    const p = createPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_id: p.id, qty_kg: 200, reason: 'sample', date: '2024-05-05' })
    const ledger = stockLedger(db)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ consumed_kg: 200, balance_kg: 800 })
  })
})
