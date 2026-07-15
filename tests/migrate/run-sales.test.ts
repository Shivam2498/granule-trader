import { describe, it, expect } from 'vitest'
import { readWorkbook } from '../../scripts/xlsx-lite.mjs'
import { openDatabase, closeDatabase } from '../../src/main/db/connection'
import { getSettings } from '../../src/main/core/reference'
import { createSale } from '../../src/main/core/sale'
import {
  parseSaleHeaders, parseStockAllocations, parseCustomerMaster, buildSalePayload
} from '../../src/main/core/migrate-sales'

const XLSX = process.env.MIGRATE_XLSX
const DB = process.env.MIGRATE_DB
const INVOICE_COL = Number(process.env.MIGRATE_INVOICE_COL ?? '11')
const COMMIT = process.env.MIGRATE_COMMIT === '1'

// Whole suite is inert unless MIGRATE_XLSX is set — so `npm test` never runs the migration.
describe.runIf(XLSX && DB)('sales migration runner', () => {
  it('migrates FY2026-27 sales, mimicking the Stock sheet lot-for-lot', () => {
    const wb = readWorkbook(XLSX!)
    const headers = parseSaleHeaders(wb.SaleInvoiceMaster)
    const allocs = parseStockAllocations(wb.Stock, INVOICE_COL)
    const master = parseCustomerMaster(wb.CustomerMaster)

    // group allocations by invoice
    const byInvoice = new Map<string, typeof allocs>()
    for (const a of allocs) {
      const arr = byInvoice.get(a.invoice_number) ?? []
      arr.push(a); byInvoice.set(a.invoice_number, arr)
    }

    const db = openDatabase(DB!)
    const homeState = getSettings(db).home_state
    if (!homeState.trim()) throw new Error('home_state is not set in this database — set it in Settings before migrating, or every sale would be booked as inter-state IGST.')

    // expected ending balance per lot = the LAST balance cell of each lot block that has migrated sales
    const expectedBalance = new Map<string, number>()  // key `${lot_code}@${lot_cost}` -> balance
    {
      let key = ''
      for (const r of wb.Stock) {
        const c0 = (r[0] ?? '').trim()
        if (c0.startsWith('Code ')) key = `${c0.slice(5).trim()}@${Number(r[8] ?? 0)}`
        else if ((r[4] ?? '').trim() === 'Sales' && (r[INVOICE_COL] ?? '').trim())
          expectedBalance.set(key, Number(r[10] ?? 0))
      }
    }

    const log: string[] = []
    let written = 0, skipped = 0, failed = 0
    let lastDate = ''

    // Process in invoice-number order so the app's gap-free numbering is satisfied.
    const invoices = [...headers.keys()].sort((a, b) =>
      Number(a.match(/RP\/(\d+)/)![1]) - Number(b.match(/RP\/(\d+)/)![1]))

    // The whole loop runs inside one manual transaction: dry runs roll back everything —
    // including any customers auto-created by resolveBuyer — so a dry run never writes.
    // Commit runs commit at the end, once every invoice has been processed.
    db.exec('BEGIN')
    for (const inv of invoices) {
      const header = headers.get(inv)!
      const lines = byInvoice.get(inv)
      if (!lines || lines.length === 0) { log.push(`SKIP ${inv}: no stock rows tagged with this invoice`); skipped++; continue }
      const already = db.prepare(`SELECT id FROM sales WHERE invoice_number = ? AND status = 'created'`).get(inv)
      if (already) { log.push(`SKIP ${inv}: already in the database`); skipped++; continue }

      try {
        const payload = buildSalePayload(db, header, lines, master, homeState)
        const drawn = payload.lines.reduce((s, l) => s + l.qty_drawn_kg, 0)
        if (COMMIT) {
          const sale = createSale(db, payload)
          if (sale.igst !== 0) throw new Error(`booked as inter-state (IGST ${sale.igst}) — check the buyer's state ("${payload.place_of_supply_state}") vs home state ("${homeState}").`)
          const diff = Math.round((sale.total_invoice_amount - header.sheet_total) * 100) / 100
          log.push(`OK   ${inv}: ${payload.lines.length} lines, ${drawn} kg, total ₹${sale.total_invoice_amount}` +
                   (Math.abs(diff) > 0.01 ? `  ⚠ sheet total ₹${header.sheet_total} (diff ${diff})` : ''))
          written++
        } else {
          // Dry run: compute tax the same way createSale would, without writing.
          if (payload.invoice_date < lastDate) log.push(`WARN ${inv}: dated ${payload.invoice_date}, earlier than the previous invoice — createSale will reject this on commit.`)
          lastDate = payload.invoice_date > lastDate ? payload.invoice_date : lastDate
          log.push(`DRY  ${inv}: ${payload.lines.length} lines, ${drawn} kg, buyer ${payload.buyer_name}`)
        }
      } catch (e) {
        log.push(`FAIL ${inv}: ${(e as Error).message}`); failed++
      }
    }
    db.exec(COMMIT ? 'COMMIT' : 'ROLLBACK')

    // Reconcile every lot that had migrated sales (only meaningful after a commit).
    const reconLog: string[] = []
    let mismatches = 0
    if (COMMIT) {
      for (const [key, expected] of expectedBalance) {
        const [code, cost] = key.split('@')
        const row = db.prepare(`
          SELECT i.qty_remaining_kg AS bal FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
          WHERE p.our_code = ? AND ABS(i.rate_per_kg - ?) <= 1
        `).get(code, Number(cost)) as { bal: number } | undefined
        const actual = row ? Math.round(row.bal * 100) / 100 : NaN
        if (Math.abs(actual - expected) > 0.01) {
          reconLog.push(`  MISMATCH lot ${code}@${cost}: sheet ${expected} kg, db ${actual} kg`)
          mismatches++
        }
      }
    }

    closeDatabase(db)

    console.log('\n===== SALES MIGRATION ' +
      (COMMIT ? '(COMMIT)' : '(DRY RUN — rolled back at the end, including any auto-created customers)') + ' =====')
    console.log(log.join('\n'))
    console.log(`\n-- written ${written}, skipped ${skipped}, failed ${failed} --`)
    if (COMMIT) {
      console.log('\n===== STOCK RECONCILIATION vs Stock sheet =====')
      console.log(reconLog.length ? reconLog.join('\n') : '  all lots reconcile exactly ✅')
    }

    // The run must not have failed any invoice, and (when committing) every lot must reconcile.
    expect(failed, 'some invoices failed — see log above').toBe(0)
    if (COMMIT) expect(mismatches, 'some lots do not match the Stock sheet — see reconciliation above').toBe(0)
  })
})
