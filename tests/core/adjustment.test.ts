import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { mkPurchase, editPurchase, lotIdOf, remainingOf } from '../helpers/purchase'
import { createStockAdjustment, stockLedger, listAdjustments, deleteAdjustment } from '../../src/main/core/adjustment'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })
const pbase = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }

describe('createStockAdjustment', () => {
  it('reduces remaining by the adjusted amount', () => {
    const p = mkPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_item_id: lotIdOf(db, p.id), qty_kg: 50, reason: 'spillage', date: '2024-05-05' })
    expect(remainingOf(db, p.id)).toBe(950)
  })
  it('rejects an adjustment larger than remaining', () => {
    const p = mkPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 100 })
    expect(() => createStockAdjustment(db, { purchase_item_id: lotIdOf(db, p.id), qty_kg: 150, reason: 'x', date: '2024-05-05' })).toThrow(/only has 100/)
    expect(remainingOf(db, p.id)).toBe(100)
  })
  it('rejects zero or negative quantity', () => {
    const p = mkPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 100 })
    expect(() => createStockAdjustment(db, { purchase_item_id: lotIdOf(db, p.id), qty_kg: 0, reason: 'x', date: '2024-05-05' }))
      .toThrow(/must be greater than zero/)
    expect(() => createStockAdjustment(db, { purchase_item_id: lotIdOf(db, p.id), qty_kg: -10, reason: 'x', date: '2024-05-05' }))
      .toThrow(/must be greater than zero/)
    expect(remainingOf(db, p.id)).toBe(100)
  })
})

describe('stockLedger', () => {
  it('lists lots with positive balance', () => {
    const p = mkPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_item_id: lotIdOf(db, p.id), qty_kg: 200, reason: 'sample', date: '2024-05-05' })
    const ledger = stockLedger(db)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ consumed_kg: 200, balance_kg: 800 })
  })
})

describe('listAdjustments + deleteAdjustment (undo)', () => {
  it('lists newest first and undo restores the lot', () => {
    const p = mkPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_item_id: lotIdOf(db, p.id), qty_kg: 200, reason: 'spillage', date: '2024-05-05' })
    const rows = listAdjustments(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ our_code: '0001/2425', qty_kg: 200, reason: 'spillage' })
    deleteAdjustment(db, rows[0].id)
    expect(remainingOf(db, p.id)).toBe(1000)   // restored
    expect(listAdjustments(db)).toHaveLength(0)
  })
})
