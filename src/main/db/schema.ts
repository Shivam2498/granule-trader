import type Database from 'better-sqlite3'

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hsn_products (
  hsn_code TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  gst_rate REAL NOT NULL DEFAULT 18
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gstin TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  billing_city TEXT NOT NULL DEFAULT '',
  billing_state TEXT NOT NULL DEFAULT '',
  billing_pincode TEXT NOT NULL DEFAULT '',
  shipping_same INTEGER NOT NULL DEFAULT 1,
  shipping_address TEXT NOT NULL DEFAULT '',
  shipping_city TEXT NOT NULL DEFAULT '',
  shipping_state TEXT NOT NULL DEFAULT '',
  shipping_pincode TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  our_code TEXT NOT NULL,
  supplier_invoice_number TEXT NOT NULL DEFAULT '',
  invoice_date TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  party_state TEXT NOT NULL DEFAULT '',
  hsn_code TEXT NOT NULL DEFAULT '',
  qty_kg REAL NOT NULL,
  qty_remaining_kg REAL NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  cgst REAL NOT NULL DEFAULT 0,
  sgst REAL NOT NULL DEFAULT 0,
  igst REAL NOT NULL DEFAULT 0,
  tcs REAL NOT NULL DEFAULT 0,
  roundoff REAL NOT NULL DEFAULT 0,
  total_invoice_amount REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_date TEXT,
  fy_label TEXT NOT NULL,
  code_seq INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL,
  fy_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  invoice_date TEXT,
  eway_bill_no TEXT,
  eway_bill_date TEXT,
  vehicle TEXT,
  buyer_customer_id INTEGER REFERENCES customers(id),
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_gstin TEXT NOT NULL DEFAULT '',
  buyer_billing_json TEXT NOT NULL DEFAULT '{}',
  buyer_shipping_json TEXT NOT NULL DEFAULT '{}',
  amount REAL NOT NULL DEFAULT 0,
  cgst REAL NOT NULL DEFAULT 0,
  sgst REAL NOT NULL DEFAULT 0,
  igst REAL NOT NULL DEFAULT 0,
  tcs REAL NOT NULL DEFAULT 0,
  roundoff REAL NOT NULL DEFAULT 0,
  total_invoice_amount REAL NOT NULL DEFAULT 0,
  total_qty_kg REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fy_label, seq)
);

CREATE TABLE IF NOT EXISTS sale_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate REAL NOT NULL DEFAULT 0,
  qty_drawn_kg REAL NOT NULL,
  rate_per_kg REAL NOT NULL,
  line_amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  qty_kg REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alloc_sale ON sale_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_alloc_purchase ON sale_allocations(purchase_id);
CREATE INDEX IF NOT EXISTS idx_adj_purchase ON stock_adjustments(purchase_id);
`

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL)
  migrate(db)
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === col)
}

function migrate(db: Database.Database): void {
  if (!hasColumn(db, 'sale_allocations', 'hsn_code'))
    db.exec(`ALTER TABLE sale_allocations ADD COLUMN hsn_code TEXT NOT NULL DEFAULT ''`)
  if (!hasColumn(db, 'sale_allocations', 'gst_rate'))
    db.exec(`ALTER TABLE sale_allocations ADD COLUMN gst_rate REAL NOT NULL DEFAULT 0`)
  // Backfill pre-existing allocations from their purchase's HSN + that HSN's rate (fallback 18)
  db.exec(`UPDATE sale_allocations SET hsn_code = COALESCE((SELECT p.hsn_code FROM purchases p WHERE p.id = sale_allocations.purchase_id), '') WHERE hsn_code = ''`)
  db.exec(`UPDATE sale_allocations SET gst_rate = COALESCE((SELECT h.gst_rate FROM hsn_products h JOIN purchases p ON p.hsn_code = h.hsn_code WHERE p.id = sale_allocations.purchase_id), 18) WHERE gst_rate = 0`)
}
