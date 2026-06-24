/**
 * One-time importer. Run on the owner's machine only. Not part of the app build.
 * Usage: node --loader ts-node/esm scripts/migrate-excel.ts <data.db> <workbook.xlsx>
 * Requires (dev-only, install when running): `npm i -D xlsx ts-node`
 */
import { openDatabase } from '../src/main/db/connection'

function main(): void {
  const [dbPath, workbook] = process.argv.slice(2)
  if (!dbPath || !workbook) {
    console.error('Usage: migrate-excel <data.db> <workbook.xlsx>')
    process.exit(1)
  }
  const db = openDatabase(dbPath)
  console.error(
    'No sheet parser configured yet. Provide a sample workbook (dummy data) so the ' +
    'column mapping for purchases/customers/sales can be implemented here. Aborting without changes.'
  )
  db.close()
  process.exit(2)
}

main()
