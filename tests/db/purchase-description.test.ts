import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/connection'
import { initSchema } from '../../src/main/db/schema'

function hasCol(db: Database.Database, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === col)
}

describe('purchases.description column', () => {
  it('exists on a freshly created database', () => {
    const db = openDatabase(':memory:')
    expect(hasCol(db, 'purchases', 'description')).toBe(true)
  })

  it('is added by migration to a legacy purchases table that lacks it', () => {
    const db = new Database(':memory:')
    // Minimal legacy purchases table without `description`.
    db.exec(`CREATE TABLE purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, our_code TEXT NOT NULL, invoice_date TEXT NOT NULL,
      qty_kg REAL NOT NULL, qty_remaining_kg REAL NOT NULL, fy_label TEXT NOT NULL, code_seq INTEGER NOT NULL
    )`)
    expect(hasCol(db, 'purchases', 'description')).toBe(false)
    initSchema(db)
    expect(hasCol(db, 'purchases', 'description')).toBe(true)
  })
})
