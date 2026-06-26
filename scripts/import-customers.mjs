// One-time bulk import of customers from a CSV into a granule-trader database.
//
// Usage:
//   1. Quit the Granule Trader app (so the database file is not locked).
//   2. If needed, build the native module for Node:  npm run rebuild:node
//   3. node scripts/import-customers.mjs <customers.csv> <path/to/granule-trader.db>
//
// Inserts every valid row (no de-duplication) and prints a report of skipped rows.
// The DB path is the "Data folder" shown in Settings, with /granule-trader.db appended.
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { parseCsv, mapCustomerRows } from './customer-import.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const [csvPath, dbPath] = process.argv.slice(2)
if (!csvPath || !dbPath) {
  console.error('Usage: node scripts/import-customers.mjs <customers.csv> <path/to/granule-trader.db>')
  process.exit(2)
}

const { toImport, skipped } = mapCustomerRows(parseCsv(readFileSync(csvPath, 'utf8')))

const db = new Database(dbPath)
const insert = db.prepare(`INSERT INTO customers
  (name,gstin,pan,phone,billing_address,billing_city,billing_state,billing_pincode,
   shipping_same,shipping_address,shipping_city,shipping_state,shipping_pincode)
  VALUES (@name,@gstin,@pan,@phone,@billing_address,@billing_city,@billing_state,@billing_pincode,
   @shipping_same,@shipping_address,@shipping_city,@shipping_state,@shipping_pincode)`)
const run = db.transaction((rows) => { for (const r of rows) insert.run({ ...r, shipping_same: r.shipping_same ? 1 : 0 }) })
run(toImport)
db.close()

console.log(`✓ Imported ${toImport.length} customer(s) into ${dbPath}`)
if (skipped.length) {
  console.log(`\nSkipped ${skipped.length} row(s):`)
  for (const s of skipped) console.log(`  line ${s.line}: ${s.name || '(no name)'} — ${s.reason}`)
}
