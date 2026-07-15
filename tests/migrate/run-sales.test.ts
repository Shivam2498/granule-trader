import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { openDatabase, closeDatabase } from '../../src/main/db/connection'
import { getSettings } from '../../src/main/core/reference'
import { createSale } from '../../src/main/core/sale'
import { createStockAdjustment } from '../../src/main/core/adjustment'
import {
  parseCsv, parseSaleHeadersCsv, parseStockCsv, parseCustomerMaster, buildSalePayload,
  resolveLotItemId, type StockAllocation
} from '../../src/main/core/migrate-sales'

const DIR = process.env.MIGRATE_DIR      // folder holding Stock.csv, SaleInvoiceMaster.csv, CustomerMaster.csv
const DB = process.env.MIGRATE_DB
const COMMIT = process.env.MIGRATE_COMMIT === '1'

const ADJ_DATE = '2026-03-31'   // last day of FY2025-26 — before every migrated invoice
const adjReason = (inv: string) => `Sold in FY2025-26 (${inv}) — before the app`

// Whole suite is inert unless MIGRATE_DIR is set — `npm test` never runs the migration.
describe.runIf(DIR && DB)('sales migration runner (CSV)', () => {
  it('migrates FY2026-27 sales + FY2025-26 opening adjustments, reconciling lot-for-lot', () => {
    const sheet = (name: string) => parseCsv(readFileSync(join(DIR!, name), 'utf8'))
    const headers = parseSaleHeadersCsv(sheet('SaleInvoiceMaster.csv'))
    const { sales, old, balances } = parseStockCsv(sheet('Stock.csv'))
    const master = parseCustomerMaster(sheet('CustomerMaster.csv'))

    const byInvoice = new Map<string, StockAllocation[]>()
    for (const a of sales) {
      const arr = byInvoice.get(a.invoice_number) ?? []
      arr.push(a); byInvoice.set(a.invoice_number, arr)
    }

    const db = openDatabase(DB!)
    const homeState = getSettings(db).home_state
    if (!homeState.trim()) throw new Error('home_state is not set in this database — set it in Settings before migrating.')

    const log: string[] = []
    let written = 0, skipped = 0, failed = 0, adjusted = 0, adjSkipped = 0

    db.exec('BEGIN')   // dry run rolls back EVERYTHING below, including auto-created customers

    // ---- Phase 1: FY2025-26 draws become opening-stock adjustments (dated before every invoice) ----
    for (const a of old) {
      try {
        const itemId = resolveLotItemId(db, a.lot_code, a.lot_cost)
        const reason = adjReason(a.invoice_number)
        const dupe = db.prepare('SELECT id FROM stock_adjustments WHERE purchase_item_id = ? AND qty_kg = ? AND reason = ?')
          .get(itemId, a.qty, reason)
        if (dupe) { adjSkipped++; continue }
        createStockAdjustment(db, { purchase_item_id: itemId, qty_kg: a.qty, reason, date: ADJ_DATE })
        adjusted++
      } catch (e) {
        log.push(`FAIL adjustment ${a.invoice_number} (lot ${a.lot_code}@${a.lot_cost}, ${a.qty} kg): ${(e as Error).message}`)
        failed++
      }
    }
    log.push(`-- opening adjustments: ${adjusted} applied, ${adjSkipped} already present --`)

    // ---- Phase 2: FY2026-27 invoices, ascending (gap-free numbering requires it) ----
    // An invoice with no stock rows (RP/039) is skipped here and becomes a reserved BLANK bill
    // automatically when the next invoice reserves the gap — fill it in the app later.
    const invoices = [...headers.keys()].sort((a, b) =>
      Number(a.match(/RP\/(\d+)/)![1]) - Number(b.match(/RP\/(\d+)/)![1]))
    let lastDate = ''

    for (const inv of invoices) {
      const header = headers.get(inv)!
      const lines = byInvoice.get(inv)
      if (!lines || lines.length === 0) { log.push(`SKIP ${inv}: no stock rows — will remain a blank (reserved) bill`); skipped++; continue }
      const already = db.prepare(`SELECT id FROM sales WHERE invoice_number = ? AND status = 'created'`).get(inv)
      if (already) { log.push(`SKIP ${inv}: already in the database`); skipped++; continue }

      try {
        const payload = buildSalePayload(db, header, lines, master, homeState)
        // Every FY2026-27 sale is intra-state. Refuse BEFORE writing, so a misconfigured buyer
        // state can never leave a wrongly-routed sale in the database.
        if ((payload.place_of_supply_state ?? '').trim().toLowerCase() !== homeState.trim().toLowerCase())
          throw new Error(`buyer state "${payload.place_of_supply_state}" differs from home state "${homeState}" — would book as inter-state IGST. Fix the buyer's state first.`)
        const drawn = payload.lines.reduce((s, l) => s + l.qty_drawn_kg, 0)
        if (COMMIT) {
          const sale = createSale(db, payload)
          if (sale.igst !== 0) throw new Error(`booked as inter-state (IGST ${sale.igst}).`)
          const diff = Math.round((sale.total_invoice_amount - header.sheet_total) * 100) / 100
          log.push(`OK   ${inv}: ${payload.lines.length} lines, ${drawn} kg, total ₹${sale.total_invoice_amount}` +
                   (Math.abs(diff) > 0.01 ? `  ⚠ register total ₹${header.sheet_total} (diff ${diff})` : ''))
          written++
        } else {
          if (payload.invoice_date < lastDate) log.push(`WARN ${inv}: dated ${payload.invoice_date}, earlier than the previous invoice — createSale will reject this on commit.`)
          lastDate = payload.invoice_date > lastDate ? payload.invoice_date : lastDate
          log.push(`DRY  ${inv}: ${payload.lines.length} lines, ${drawn} kg, buyer ${payload.buyer_name}`)
        }
      } catch (e) {
        log.push(`FAIL ${inv}: ${(e as Error).message}`); failed++
      }
    }

    db.exec(COMMIT ? 'COMMIT' : 'ROLLBACK')

    // ---- Phase 3: reconciliation — every sheet lot's app balance equals its Balance column ----
    const reconLog: string[] = []
    let mismatches = 0
    if (COMMIT) {
      for (const [key, expected] of balances) {
        const [code, cost] = key.split('@')
        let actual = NaN
        try {
          const itemId = resolveLotItemId(db, code, Number(cost))
          const row = db.prepare('SELECT qty_remaining_kg AS bal FROM purchase_items WHERE id = ?').get(itemId) as { bal: number }
          actual = Math.round(row.bal * 100) / 100
        } catch { /* unresolvable key falls through as NaN → mismatch */ }
        if (Math.abs(actual - expected) > 0.01) {
          reconLog.push(`  MISMATCH lot ${key}: sheet ${expected} kg, app ${actual} kg`)
          mismatches++
        }
      }
      // Lots the app knows but the sheet does not track — informational, never a failure.
      const sheetCodes = new Set([...balances.keys()].map(k => k.split('@')[0]))
      const untracked = db.prepare(`
        SELECT p.our_code, i.qty_remaining_kg, i.rate_per_kg FROM purchase_items i
        JOIN purchases p ON p.id = i.purchase_id`).all() as Array<{ our_code: string; qty_remaining_kg: number; rate_per_kg: number }>
      for (const u of untracked) {
        if (!sheetCodes.has(u.our_code))
          reconLog.push(`  NOTE untracked lot ${u.our_code} @ ${u.rate_per_kg}/kg: app carries ${u.qty_remaining_kg} kg (sheet has no block for it)`)
      }
    }

    closeDatabase(db)

    console.log('\n===== SALES MIGRATION ' + (COMMIT ? '(COMMIT)' : '(DRY RUN — rolled back)') + ' =====')
    console.log(log.join('\n'))
    console.log(`\n-- invoices: written ${written}, skipped ${skipped}, failed ${failed} --`)
    if (COMMIT) {
      console.log('\n===== STOCK RECONCILIATION vs Stock sheet =====')
      console.log(reconLog.length ? reconLog.join('\n') : '  all lots reconcile exactly ✅')
    }

    expect(failed, 'some rows failed — see log above').toBe(0)
    if (COMMIT) expect(mismatches, 'some lots do not match the Stock sheet — see reconciliation above').toBe(0)
  })
})
