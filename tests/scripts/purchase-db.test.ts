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
  it('flags an existing (fy_label, code_seq) as a duplicate and lists new suppliers', () => {
    commitImport(db, [row()])
    const plan = planImport(db, [row({ description: 'again' }), row({ our_code: '083/2526', code_seq: 83, party: 'NEWCO' })])
    expect(plan.duplicates.map((d: any) => d.code_seq)).toEqual([82])
    expect(plan.toInsert.map((d: any) => d.code_seq)).toEqual([83])
    expect(plan.suppliersToCreate).toEqual(['NEWCO'])
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

  it('re-running with the same lot inserts nothing new (dedup by fy_label+code_seq)', () => {
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
