import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/connection'
import { initSchema } from '../../src/main/db/schema'

describe('schema', () => {
  it('creates all core tables', () => {
    const db = openDatabase(':memory:')
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name)
    for (const t of ['customers','hsn_products','purchases','sale_allocations','sales','settings','stock_adjustments'])
      expect(names).toContain(t)
    db.close()
  })

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })

  it('sale_allocations carries hsn_code and gst_rate', () => {
    const db = openDatabase(':memory:')
    const cols = db.prepare("PRAGMA table_info(sale_allocations)").all().map((r: any) => r.name)
    expect(cols).toContain('hsn_code'); expect(cols).toContain('gst_rate')
    db.close()
  })

  it('migrates a legacy sale_allocations table to add hsn_code + gst_rate', () => {
    const db = new Database(':memory:')
    // simulate the v1 schema (no hsn_code/gst_rate)
    db.exec(`CREATE TABLE sale_allocations (id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER, purchase_id INTEGER, qty_drawn_kg REAL, rate_per_kg REAL, line_amount REAL)`)
    initSchema(db)   // runs CREATE IF NOT EXISTS (no-op for this table) then migrate()
    const cols = (db.prepare("PRAGMA table_info(sale_allocations)").all() as any[]).map(c => c.name)
    expect(cols).toContain('hsn_code'); expect(cols).toContain('gst_rate')
    db.close()
  })

  it('migrates a legacy purchases table to add rate_per_kg + supplier address', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, our_code TEXT, supplier_invoice_number TEXT, invoice_date TEXT, party TEXT, party_state TEXT, hsn_code TEXT, qty_kg REAL, qty_remaining_kg REAL, amount REAL, cgst REAL, sgst REAL, igst REAL, tcs REAL, roundoff REAL, total_invoice_amount REAL, payment_status TEXT, payment_date TEXT, fy_label TEXT, code_seq INTEGER, created_at TEXT)`)
    db.prepare(`INSERT INTO purchases (qty_kg, amount, fy_label, code_seq, invoice_date, qty_remaining_kg) VALUES (100, 5000, '2024-25', 1, '2024-05-01', 100)`).run()
    initSchema(db)
    const cols = (db.prepare("PRAGMA table_info(purchases)").all() as any[]).map(c => c.name)
    for (const c of ['rate_per_kg','party_city','party_pincode','party_address']) expect(cols).toContain(c)
    const row = db.prepare('SELECT rate_per_kg FROM purchases WHERE id = 1').get() as { rate_per_kg: number }
    expect(row.rate_per_kg).toBe(50)   // 5000 / 100 backfilled
    db.close()
  })
})
