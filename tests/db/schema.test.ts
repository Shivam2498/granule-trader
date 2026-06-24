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
})
