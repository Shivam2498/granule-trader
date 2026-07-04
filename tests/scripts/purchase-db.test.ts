import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
// @ts-expect-error — plain ESM module, no types
import { planImport, commitImport, ensureDescriptionColumn } from '../../scripts/purchase-db.mjs'

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
