import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../../src/main/db/schema'

// Builds a database in the shape it had BEFORE purchase_items existed: the lot lives on the
// purchases row, and allocations/adjustments point straight at the purchase.
function legacyDb(): Database.Database {
  const db = new Database(':memory:')
  db.exec(`
    CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE hsn_products (hsn_code TEXT PRIMARY KEY, description TEXT NOT NULL DEFAULT '', gst_rate REAL NOT NULL DEFAULT 18);
    CREATE TABLE purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, our_code TEXT NOT NULL, supplier_invoice_number TEXT NOT NULL DEFAULT '',
      invoice_date TEXT NOT NULL, party TEXT NOT NULL DEFAULT '', party_state TEXT NOT NULL DEFAULT '',
      party_city TEXT NOT NULL DEFAULT '', party_pincode TEXT NOT NULL DEFAULT '', party_address TEXT NOT NULL DEFAULT '',
      supplier_id INTEGER, hsn_code TEXT NOT NULL DEFAULT '', description TEXT NOT NULL DEFAULT '',
      qty_kg REAL NOT NULL, qty_remaining_kg REAL NOT NULL, rate_per_kg REAL NOT NULL DEFAULT 0, amount REAL NOT NULL DEFAULT 0,
      cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0, igst REAL NOT NULL DEFAULT 0, tcs REAL NOT NULL DEFAULT 0,
      roundoff REAL NOT NULL DEFAULT 0, total_invoice_amount REAL NOT NULL DEFAULT 0,
      payment_status TEXT NOT NULL DEFAULT 'pending', payment_date TEXT, fy_label TEXT NOT NULL, code_seq INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT, invoice_number TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT '', seq INTEGER NOT NULL,
      fy_label TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'created', invoice_date TEXT, eway_bill_no TEXT, eway_bill_date TEXT,
      vehicle TEXT, buyer_customer_id INTEGER, buyer_name TEXT NOT NULL DEFAULT '', buyer_gstin TEXT NOT NULL DEFAULT '',
      buyer_billing_json TEXT NOT NULL DEFAULT '{}', buyer_shipping_json TEXT NOT NULL DEFAULT '{}',
      amount REAL NOT NULL DEFAULT 0, cgst REAL NOT NULL DEFAULT 0, sgst REAL NOT NULL DEFAULT 0, igst REAL NOT NULL DEFAULT 0,
      tcs REAL NOT NULL DEFAULT 0, roundoff REAL NOT NULL DEFAULT 0, total_invoice_amount REAL NOT NULL DEFAULT 0,
      total_qty_kg REAL NOT NULL DEFAULT 0, payment_status TEXT NOT NULL DEFAULT 'pending', payment_date TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(fy_label, seq)
    );
    CREATE TABLE sale_allocations (
      id INTEGER PRIMARY KEY AUTOINCREMENT, sale_id INTEGER NOT NULL, purchase_id INTEGER NOT NULL,
      hsn_code TEXT NOT NULL DEFAULT '', gst_rate REAL NOT NULL DEFAULT 0,
      qty_drawn_kg REAL NOT NULL, rate_per_kg REAL NOT NULL, line_amount REAL NOT NULL
    );
    CREATE TABLE stock_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, purchase_id INTEGER NOT NULL, qty_kg REAL NOT NULL,
      reason TEXT NOT NULL DEFAULT '', date TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO settings(key,value) VALUES('schema_version','1');
    INSERT INTO hsn_products(hsn_code, description, gst_rate) VALUES ('39021000','PP Granules',5);

    -- 1000 kg bought, 300 sold, 50 written off → 650 kg left on the purchases row.
    INSERT INTO purchases (id, our_code, invoice_date, party, hsn_code, description, qty_kg, qty_remaining_kg,
      rate_per_kg, amount, fy_label, code_seq)
      VALUES (7, '0007/2526', '2026-01-12', 'Reliance', '39021000', 'PP Granules', 1000, 650, 80, 80000, '2026-27', 7);
    INSERT INTO sales (id, invoice_number, seq, fy_label, invoice_date) VALUES (3, 'RP/003/2026-27', 3, '2026-27', '2026-02-01');
    INSERT INTO sale_allocations (sale_id, purchase_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (3, 7, '39021000', 5, 300, 90, 27000);
    INSERT INTO stock_adjustments (purchase_id, qty_kg, reason, date) VALUES (7, 50, 'Damaged', '2026-02-05');
  `)
  return db
}

describe('migration to purchase_items (schema_version 2)', () => {
  it('turns each existing purchase into exactly one item carrying its live remaining quantity', () => {
    const db = legacyDb()
    initSchema(db)

    const items = db.prepare('SELECT * FROM purchase_items').all() as any[]
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      purchase_id: 7, hsn_code: '39021000', description: 'PP Granules',
      qty_kg: 1000, qty_remaining_kg: 650, rate_per_kg: 80, amount: 80000, line_no: 1
    })
  })

  it('takes the item GST rate from the HSN product', () => {
    const db = legacyDb()
    initSchema(db)
    expect((db.prepare('SELECT gst_rate FROM purchase_items').get() as any).gst_rate).toBe(5)
  })

  it('repoints existing allocations and adjustments at the new item', () => {
    const db = legacyDb()
    initSchema(db)
    const itemId = (db.prepare('SELECT id FROM purchase_items').get() as any).id

    expect((db.prepare('SELECT purchase_item_id FROM sale_allocations').get() as any).purchase_item_id).toBe(itemId)
    expect((db.prepare('SELECT purchase_item_id FROM stock_adjustments').get() as any).purchase_item_id).toBe(itemId)
  })

  it('is idempotent — running it twice does not duplicate items', () => {
    const db = legacyDb()
    initSchema(db)
    initSchema(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchase_items').get()).toEqual({ n: 1 })
    expect((db.prepare(`SELECT value FROM settings WHERE key='schema_version'`).get() as any).value).toBe('2')
  })

  it('leaves a fresh database with no items and version 2', () => {
    const db = new Database(':memory:')
    initSchema(db)
    expect(db.prepare('SELECT COUNT(*) AS n FROM purchase_items').get()).toEqual({ n: 0 })
    expect((db.prepare(`SELECT value FROM settings WHERE key='schema_version'`).get() as any).value).toBe('2')
  })
})
