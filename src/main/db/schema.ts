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
  email TEXT NOT NULL DEFAULT '',
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

CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gstin TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  pincode TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  our_code TEXT NOT NULL,
  supplier_invoice_number TEXT NOT NULL DEFAULT '',
  invoice_date TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  party_state TEXT NOT NULL DEFAULT '',
  party_city TEXT NOT NULL DEFAULT '',
  party_pincode TEXT NOT NULL DEFAULT '',
  party_address TEXT NOT NULL DEFAULT '',
  supplier_id INTEGER REFERENCES suppliers(id),
  hsn_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty_kg REAL NOT NULL,
  qty_remaining_kg REAL NOT NULL,
  rate_per_kg REAL NOT NULL DEFAULT 0,
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
  place_of_supply_state TEXT NOT NULL DEFAULT '',
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

-- One line of a supplier invoice. THIS ROW IS THE STOCK LOT: a purchase may carry several
-- materials, and each is drawn down independently. The per-line columns still present on
-- the purchases table mirror line 1 for old single-line records and are no longer the
-- source of truth for stock.
CREATE TABLE IF NOT EXISTS purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  hsn_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty_kg REAL NOT NULL,
  qty_remaining_kg REAL NOT NULL,
  rate_per_kg REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 0,
  line_no INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS sale_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  purchase_item_id INTEGER REFERENCES purchase_items(id),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate REAL NOT NULL DEFAULT 0,
  qty_drawn_kg REAL NOT NULL,
  rate_per_kg REAL NOT NULL,
  line_amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  purchase_item_id INTEGER REFERENCES purchase_items(id),
  qty_kg REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alloc_sale ON sale_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_alloc_purchase ON sale_allocations(purchase_id);
CREATE INDEX IF NOT EXISTS idx_adj_purchase ON stock_adjustments(purchase_id);
CREATE INDEX IF NOT EXISTS idx_item_purchase ON purchase_items(purchase_id);
`

// Indexes on purchase_item_id cannot live in SCHEMA_SQL: on an existing database the tables are
// already there, so CREATE TABLE IF NOT EXISTS is a no-op and the column only appears once the
// ALTER in migrate() has run. Creating them here keeps that ordering honest.
const POST_MIGRATE_SQL = `
CREATE INDEX IF NOT EXISTS idx_alloc_item ON sale_allocations(purchase_item_id);
CREATE INDEX IF NOT EXISTS idx_adj_item ON stock_adjustments(purchase_item_id);
`

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL)
  migrate(db)
  db.exec(POST_MIGRATE_SQL)
}

function hasColumn(db: Database.Database, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === col)
}

function migrate(db: Database.Database): void {
  // Additive column adds — always idempotent
  if (!hasColumn(db, 'sale_allocations', 'hsn_code'))
    db.exec(`ALTER TABLE sale_allocations ADD COLUMN hsn_code TEXT NOT NULL DEFAULT ''`)
  if (!hasColumn(db, 'sale_allocations', 'gst_rate'))
    db.exec(`ALTER TABLE sale_allocations ADD COLUMN gst_rate REAL NOT NULL DEFAULT 0`)
  for (const [col, ddl] of [
    ['rate_per_kg', `ALTER TABLE purchases ADD COLUMN rate_per_kg REAL NOT NULL DEFAULT 0`],
    ['party_city', `ALTER TABLE purchases ADD COLUMN party_city TEXT NOT NULL DEFAULT ''`],
    ['party_pincode', `ALTER TABLE purchases ADD COLUMN party_pincode TEXT NOT NULL DEFAULT ''`],
    ['party_address', `ALTER TABLE purchases ADD COLUMN party_address TEXT NOT NULL DEFAULT ''`],
    ['supplier_id', `ALTER TABLE purchases ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)`],
    ['description', `ALTER TABLE purchases ADD COLUMN description TEXT NOT NULL DEFAULT ''`]
  ] as const) {
    if (!hasColumn(db, 'purchases', col)) db.exec(ddl)
  }
  if (!hasColumn(db, 'sales', 'place_of_supply_state'))
    db.exec(`ALTER TABLE sales ADD COLUMN place_of_supply_state TEXT NOT NULL DEFAULT ''`)
  if (!hasColumn(db, 'customers', 'email'))
    db.exec(`ALTER TABLE customers ADD COLUMN email TEXT NOT NULL DEFAULT ''`)
  if (!hasColumn(db, 'suppliers', 'email'))
    db.exec(`ALTER TABLE suppliers ADD COLUMN email TEXT NOT NULL DEFAULT ''`)
  if (!hasColumn(db, 'sale_allocations', 'purchase_item_id'))
    db.exec(`ALTER TABLE sale_allocations ADD COLUMN purchase_item_id INTEGER REFERENCES purchase_items(id)`)
  if (!hasColumn(db, 'stock_adjustments', 'purchase_item_id'))
    db.exec(`ALTER TABLE stock_adjustments ADD COLUMN purchase_item_id INTEGER REFERENCES purchase_items(id)`)

  // Data-mutating backfills — run only once (schema_version gate)
  const vRow = db.prepare(`SELECT value FROM settings WHERE key = 'schema_version'`).get() as { value: string } | undefined
  const version = vRow ? parseInt(vRow.value, 10) : 0
  if (version < 1) {
    // Backfill pre-existing allocations from their purchase's HSN + that HSN's rate (fallback 18)
    db.exec(`UPDATE sale_allocations SET hsn_code = COALESCE((SELECT p.hsn_code FROM purchases p WHERE p.id = sale_allocations.purchase_id), '') WHERE hsn_code = ''`)
    db.exec(`UPDATE sale_allocations SET gst_rate = COALESCE((SELECT h.gst_rate FROM hsn_products h JOIN purchases p ON p.hsn_code = h.hsn_code WHERE p.id = sale_allocations.purchase_id), 18) WHERE gst_rate = 0`)
    // Backfill a rate for legacy purchases that have an amount but no rate
    db.exec(`UPDATE purchases SET rate_per_kg = round(amount / qty_kg, 2) WHERE rate_per_kg = 0 AND qty_kg > 0 AND amount > 0`)
    db.exec(`INSERT INTO settings(key,value) VALUES('schema_version','1') ON CONFLICT(key) DO UPDATE SET value='1'`)
  }

  // v2 — the stock lot moves from `purchases` to `purchase_items`. Every purchase that predates
  // this had exactly one line, so it becomes exactly one item carrying that line's live remaining
  // quantity; allocations and adjustments are then repointed at it. Gated, so it runs once.
  if (version < 2) {
    db.exec(`
      INSERT INTO purchase_items (purchase_id, hsn_code, description, qty_kg, qty_remaining_kg, rate_per_kg, amount, gst_rate, line_no)
      SELECT p.id, COALESCE(p.hsn_code, ''), COALESCE(p.description, ''),
             COALESCE(p.qty_kg, 0), COALESCE(p.qty_remaining_kg, 0),
             COALESCE(p.rate_per_kg, 0), COALESCE(p.amount, 0),
             COALESCE((SELECT h.gst_rate FROM hsn_products h WHERE h.hsn_code = p.hsn_code), 18), 1
      FROM purchases p
      WHERE NOT EXISTS (SELECT 1 FROM purchase_items i WHERE i.purchase_id = p.id)
    `)
    db.exec(`
      UPDATE sale_allocations SET purchase_item_id = (
        SELECT i.id FROM purchase_items i WHERE i.purchase_id = sale_allocations.purchase_id ORDER BY i.line_no LIMIT 1
      ) WHERE purchase_item_id IS NULL
    `)
    db.exec(`
      UPDATE stock_adjustments SET purchase_item_id = (
        SELECT i.id FROM purchase_items i WHERE i.purchase_id = stock_adjustments.purchase_id ORDER BY i.line_no LIMIT 1
      ) WHERE purchase_item_id IS NULL
    `)
    db.exec(`INSERT INTO settings(key,value) VALUES('schema_version','2') ON CONFLICT(key) DO UPDATE SET value='2'`)
  }
}
