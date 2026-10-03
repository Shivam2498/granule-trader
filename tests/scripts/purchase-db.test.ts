import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
// @ts-expect-error — plain ESM module, no types
import { planImport, commitImport, ensureDescriptionColumn } from '../../scripts/purchase-db.mjs'
import { listAvailableLots } from '../../src/main/core/available-lots'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const row = (over: Partial<any> = {}) => ({
  our_code: '082/2526', supplier_invoice_number: 'SPL/1', invoice_date: '2026-01-12', party: 'SWASTIK',
  description: 'Black M/B', hsn_code: '320419', gst_rate: 18, qty_kg: 300, rate_per_kg: 170, amount: 51000,
  cgst: 4590, sgst: 4590, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 60180,
  fy_label: '2025-26', code_seq: 82, ...over,
})

describe('planImport', () => {
  it('flags an exact-duplicate line and lists new suppliers', () => {
    commitImport(db, [row()])
    const plan = planImport(db, [row(), row({ our_code: '083/2526', code_seq: 83, party: 'NEWCO', description: 'Nat' })])
    expect(plan.duplicates.map((d: any) => d.our_code)).toEqual(['082/2526'])
    expect(plan.toInsert.map((d: any) => d.our_code)).toEqual(['083/2526'])
    expect(plan.suppliersToCreate).toEqual(['NEWCO'])
  })

  it('imports multiple lines that share a code number but differ by item or suffix', () => {
    // One invoice with two products (Black/White M/B), plus a base + letter-suffixed lot —
    // all four are distinct lots and must import (per-line dedup, not per-code).
    const plan = planImport(db, [
      row({ description: 'Black M/B' }),
      row({ description: 'White M/B', amount: 30600 }),
      row({ our_code: '094/2526', code_seq: 94, description: 'Nat' }),
      row({ our_code: '094A/2526', code_seq: 94, description: 'Nat' }),
    ])
    expect(plan.toInsert).toHaveLength(4)
    expect(plan.duplicates).toHaveLength(0)
  })
})

describe('description corrections', () => {
  it('treats a lot whose only change is its description as a relabel, not a new lot', () => {
    commitImport(db, [row({ our_code: '004/2627', code_seq: 4, fy_label: '2026-27', description: 'Black M/B' })])
    const plan = planImport(db, [row({ our_code: '004/2627', code_seq: 4, fy_label: '2026-27', description: 'White M/B' })])
    expect(plan.toInsert).toHaveLength(0)
    expect(plan.relabels).toEqual([expect.objectContaining({ our_code: '004/2627', from: 'Black M/B', to: 'White M/B' })])

    commitImport(db, [], { relabels: plan.relabels })
    expect(db.prepare('SELECT description FROM purchases').all()).toEqual([{ description: 'White M/B' }])
    expect(db.prepare('SELECT description FROM purchase_items').all()).toEqual([{ description: 'White M/B' }])
    expect(db.prepare('SELECT COUNT(*) c FROM purchases').get()).toEqual({ c: 1 })
  })

  it('does not relabel when two existing lots could be the match', () => {
    commitImport(db, [row({ description: 'Black M/B' }), row({ description: 'Grey M/B' })])
    const plan = planImport(db, [row({ description: 'White M/B' })])
    expect(plan.relabels).toHaveLength(0)
    expect(plan.toInsert).toHaveLength(1)
  })
})

describe('commitImport', () => {
  it('inserts a purchase, links a supplier by name, ensures the HSN, and keeps the sheet values', () => {
    const { inserted, suppliersCreated } = commitImport(db, [row()])
    expect(inserted).toBe(1)
    expect(suppliersCreated).toBe(1)
    const p: any = db.prepare('SELECT * FROM purchases WHERE code_seq = 82 AND fy_label = ?').get('2025-26')
    expect(p.description).toBe('Black M/B')
    expect(p.total_invoice_amount).toBe(60180)
    expect(p.qty_remaining_kg).toBe(300)
    expect(p.payment_status).toBe('done')
    expect(p.supplier_id).toBeGreaterThan(0)
    const s: any = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(p.supplier_id)
    expect(s.name).toBe('SWASTIK')
    expect(db.prepare('SELECT COUNT(*) c FROM hsn_products WHERE hsn_code = ?').get('320419')).toMatchObject({ c: 1 })
  })

  it('marks imported purchases pending (no payment date) when asked', () => {
    commitImport(db, [row()], { paymentStatus: 'pending' })
    const p: any = db.prepare('SELECT payment_status, payment_date FROM purchases WHERE code_seq = 82').get()
    expect(p.payment_status).toBe('pending')
    expect(p.payment_date).toBe(null)
  })

  it('re-running with the same lot inserts nothing new (per-line dedup)', () => {
    commitImport(db, [row()])
    const plan = planImport(db, [row()])
    expect(plan.toInsert).toHaveLength(0)
    expect(plan.duplicates).toHaveLength(1)
  })

  it('ensureDescriptionColumn adds the column to a DB that lacks it', () => {
    db.exec('ALTER TABLE purchases DROP COLUMN description')
    ensureDescriptionColumn(db)
    const cols = db.prepare('PRAGMA table_info(purchases)').all() as Array<{ name: string }>
    expect(cols.some(c => c.name === 'description')).toBe(true)
  })
})

describe('imported purchases are sellable stock', () => {
  it('creates a purchase_item lot for every imported row', () => {
    commitImport(db, [row()])
    const items = db.prepare('SELECT * FROM purchase_items').all() as any[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ hsn_code: row().hsn_code, qty_kg: row().qty_kg, line_no: 1 })
    // the lot starts full — nothing has been sold from it yet
    expect(items[0].qty_remaining_kg).toBe(row().qty_kg)
  })

  it('shows the imported lot as available stock', () => {
    commitImport(db, [row()])
    const lots = listAvailableLots(db, '2099-01-01')
    expect(lots).toHaveLength(1)
    expect(lots[0].available_kg).toBe(row().qty_kg)
  })
})
