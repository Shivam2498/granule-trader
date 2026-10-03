// One-time purchase import from a CSV export into a granule-trader database.
//
// Usage:
//   1. Quit the Granule Trader app (so the database file is not locked).
//   2. Build the native module for Node once:  npm run rebuild:node
//   3. Dry-run (writes NOTHING to the DB):
//        node scripts/import-purchases.mjs <path/to/granule-trader.db> <purchases.csv>
//   4. Review the *.log and *-skipped.csv files written next to the CSV, then:
//        node scripts/import-purchases.mjs <path/to/granule-trader.db> <purchases.csv> --commit
//
// Idempotent: re-running skips lots whose (financial year, code sequence) already exist.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { createRequire } from 'node:module'
import { parseCsv } from './customer-import.mjs'
import { mapPurchaseRows, buildLogReport, buildSkippedCsv } from './purchase-import.mjs'
import { ensureDescriptionColumn, planImport, commitImport } from './purchase-db.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const payIdx = args.indexOf('--payment')
const paymentStatus = payIdx >= 0 ? args[payIdx + 1] : 'done'
const [dbPath, csvPath] = args.filter((a, i) => a !== '--commit' && i !== payIdx && i !== payIdx + 1)
if (!dbPath || !csvPath || !['done', 'pending'].includes(paymentStatus)) {
  console.error('Usage: node scripts/import-purchases.mjs <granule-trader.db> <purchases.csv> [--payment done|pending] [--commit]')
  process.exit(2)
}

const { header, toImport, skipped, warnings } = mapPurchaseRows(parseCsv(readFileSync(csvPath, 'utf8')))

const db = new Database(dbPath)
ensureDescriptionColumn(db)
const { toInsert, duplicates, relabels, suppliersToCreate } = planImport(db, toImport)

const counts = { read: toImport.length + skipped.length, toInsert: toInsert.length, duplicate: duplicates.length, skipped: skipped.length }
const mode = commit ? 'commit' : 'dry-run'
const log = buildLogReport({ mode, csvPath, counts, skipped, warnings, suppliersToCreate })
const skippedCsv = buildSkippedCsv(header, skipped)

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const base = basename(csvPath).replace(/\.[^.]+$/, '')
const dir = dirname(csvPath)
const logPath = join(dir, `${base}-import-${stamp}.log`)
const skPath = join(dir, `${base}-import-skipped-${stamp}.csv`)
writeFileSync(logPath, log)
writeFileSync(skPath, skippedCsv)

console.log(log)
for (const x of relabels) console.log(`Relabel ${x.our_code}: "${x.from}" → "${x.to}"`)
console.log(`\nReport:        ${logPath}`)
console.log(`Skipped rows:  ${skPath}`)

if (!commit) {
  console.log('\nDry-run — nothing written to the database. Re-run with --commit to import.')
  db.close()
  process.exit(0)
}

try {
  const { inserted, suppliersCreated, relabelled } = commitImport(db, toInsert, { paymentStatus, relabels })
  console.log(`\n✓ Imported ${inserted} purchase(s), relabelled ${relabelled}, created ${suppliersCreated} supplier(s). Skipped ${duplicates.length} duplicate(s), ${skipped.length} invalid.`)
} catch (e) {
  console.error('Import failed (rolled back):', e.message)
  db.close()
  process.exit(1)
}
db.close()
