import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../src/main/db/schema'

function freshDb(): Database.Database {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  return db
}

describe('schema migration — schema_version guard', () => {
  it('sets schema_version to the latest version on a fresh DB after initSchema', () => {
    const db = freshDb()
    initSchema(db)
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).get() as { value: string } | undefined
    expect(row?.value).toBe('3')
  })

  it('does NOT overwrite a legitimately 0%-rated sale_allocation on re-run', () => {
    const db = freshDb()
    // First run: sets up schema + version '1'
    initSchema(db)

    // Insert a purchase and a sale_allocation with gst_rate = 0 (legit 0%-GST item)
    db.exec(`INSERT INTO purchases (our_code, supplier_invoice_number, invoice_date, party, party_state,
      qty_kg, qty_remaining_kg, fy_label, code_seq)
      VALUES ('0001/2425','S','2024-05-01','Acme','Gujarat',1000,1000,'2024-25',1)`)
    const { id: purchaseId } = db.prepare(`SELECT id FROM purchases WHERE our_code = '0001/2425'`).get() as { id: number }

    db.exec(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status)
      VALUES ('RP/001/2024-25','RP',1,'2024-25','created')`)
    const { id: saleId } = db.prepare(`SELECT id FROM sales WHERE seq = 1`).get() as { id: number }

    db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (?, ?, '3902', 0, 100, 80, 8000)`).run(saleId, purchaseId)

    // Second run: should NOT touch the 0% allocation because schema_version = '1'
    initSchema(db)

    const alloc = db.prepare(`SELECT gst_rate FROM sale_allocations WHERE sale_id = ?`).get(saleId) as { gst_rate: number }
    expect(alloc.gst_rate).toBe(0)
  })

  it('backfill DOES run on a DB that has no schema_version yet (simulates pre-version legacy DB)', () => {
    const db = freshDb()
    // Bootstrap schema without triggering initSchema (simulate legacy DB that has tables but no version)
    // We'll call initSchema once to build tables, then delete the version row and re-insert 0-gst row
    initSchema(db)
    db.exec(`DELETE FROM settings WHERE key = 'schema_version'`)

    // Insert purchase + allocation with hsn_code '' to simulate pre-backfill state
    db.exec(`INSERT INTO hsn_products (hsn_code, description, gst_rate) VALUES ('3902','Granules',12)`)
    db.exec(`INSERT INTO purchases (our_code, supplier_invoice_number, invoice_date, party, party_state,
      qty_kg, qty_remaining_kg, fy_label, code_seq, hsn_code)
      VALUES ('0001/2425','S','2024-05-01','Acme','Gujarat',1000,1000,'2024-25',1,'3902')`)
    const { id: purchaseId } = db.prepare(`SELECT id FROM purchases WHERE our_code = '0001/2425'`).get() as { id: number }

    db.exec(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status)
      VALUES ('RP/001/2024-25','RP',1,'2024-25','created')`)
    const { id: saleId } = db.prepare(`SELECT id FROM sales WHERE seq = 1`).get() as { id: number }

    db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (?, ?, '', 0, 100, 80, 8000)`).run(saleId, purchaseId)

    // Re-run initSchema — now version < 1 so backfill should fire
    initSchema(db)

    const alloc = db.prepare(`SELECT hsn_code, gst_rate FROM sale_allocations WHERE sale_id = ?`).get(saleId) as { hsn_code: string; gst_rate: number }
    expect(alloc.hsn_code).toBe('3902')   // backfilled from purchase
    expect(alloc.gst_rate).toBe(12)        // backfilled from hsn_products

    // And version is now set — a versionless legacy DB is carried all the way to the latest
    const vRow = db.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).get() as { value: string }
    expect(vRow.value).toBe('3')
  })
})
