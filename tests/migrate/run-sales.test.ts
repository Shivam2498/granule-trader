import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { openDatabase, closeDatabase } from '../../src/main/db/connection'
import { getSettings } from '../../src/main/core/reference'
import { createSale, updateSale, getSale } from '../../src/main/core/sale'
import { createStockAdjustment } from '../../src/main/core/adjustment'
import { createCustomer } from '../../src/main/core/customers'
import { isGstin, panFromGstin } from '../../src/shared/validation'
import {
  parseCsv, parseSaleHeadersCsv, parseStockCsv, parseCustomerMaster, registerMatchedPayload,
  resolveLotItemId, type StockAllocation
} from '../../src/main/core/migrate-sales'

const DIR = process.env.MIGRATE_DIR      // folder holding the Sales/Stocks/Customers CSV exports
const DB = process.env.MIGRATE_DB
const COMMIT = process.env.MIGRATE_COMMIT === '1'
const PAYMENT: 'done' | 'pending' = process.env.MIGRATE_PAYMENT === 'pending' ? 'pending' : 'done'

const ADJ_DATE = '2026-03-31'   // last day of FY2025-26 — before every migrated invoice
const adjReason = (inv: string) => `Sold in FY2025-26 (${inv}) — before the app`

// Owner-ruled corrections to the Stock sheet's Balance column, decided against the purchase
// register (the ruling document). Key = `${lot_code}@${lot_cost}` as the sheet records it.
const SHEET_CORRECTIONS: Record<string, { expected: number; why: string }> = {
  // Sheet opens lot 094/2526 at 250 kg; supplier bill SPL/25-26/3398 (purchase register) says
  // 300 kg were bought. Same ₹56,250 value — the sheet transposed qty/rate. 300 − 250 sold = 50.
  '094/2526@225': { expected: 50, why: 'sheet opened the lot at 250 kg; the purchase register says 300 kg bought (SPL/25-26/3398)' }
}

// July 2026 rulings: these invoices follow the Stock sheet, not the register's amounts.
const SHEET_WINS = new Set(['RP/002/2026-27', 'RP/003/2026-27', 'RP/023/2026-27', 'RP/027/2026-27'])

// October 2026 rulings: the register's amount stands even though the sheet's lines disagree by
// more than rounding.
const REGISTER_WINS: Record<string, string> = {
  'RP/061/2026-27': 'register ₹1,12,050 (₹149.40/kg) over the sheet\'s 750 kg × ₹147'
}

// The owner's exports have carried two naming schemes; take whichever is in the folder.
function sheetName(...names: string[]): string {
  const found = names.find(n => existsSync(join(DIR!, n)))
  if (!found) throw new Error(`None of ${names.join(', ')} is in ${DIR}.`)
  return found
}

// Whole suite is inert unless MIGRATE_DIR is set — `npm test` never runs the migration.
describe.runIf(DIR && DB)('sales migration runner (CSV)', () => {
  it('migrates sales to match the register, reconciling invoice-for-invoice and lot-for-lot', () => {
    const sheet = (name: string) => parseCsv(readFileSync(join(DIR!, name), 'utf8'))
    const headers = parseSaleHeadersCsv(sheet(sheetName('Sales.csv', 'SaleInvoiceMaster.csv')))
    const { sales, old, balances } = parseStockCsv(sheet(sheetName('Stocks.csv', 'Stock.csv')))
    const master = parseCustomerMaster(sheet(sheetName('Customers.csv', 'CustomerMaster.csv')))

    const byInvoice = new Map<string, StockAllocation[]>()
    for (const a of sales) {
      const arr = byInvoice.get(a.invoice_number) ?? []
      arr.push(a); byInvoice.set(a.invoice_number, arr)
    }

    const db = openDatabase(DB!)
    const homeState = getSettings(db).home_state
    if (!homeState.trim()) throw new Error('home_state is not set in this database — set it in Settings before migrating.')

    const log: string[] = []
    let written = 0, corrected = 0, skipped = 0, failed = 0, adjusted = 0, adjSkipped = 0, customersAdded = 0

    // Everything runs in one transaction. A dry run rolls ALL of it back after reconciling; a
    // commit run only commits if nothing failed and everything reconciles.
    db.exec('BEGIN')

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

    // ---- Phase 2: customers in the master that the app doesn't have yet ----
    // Skipped: a malformed GSTIN (the app would refuse it) and parties that are really suppliers.
    const supplierNames = new Set((db.prepare('SELECT name FROM suppliers').all() as { name: string }[])
      .map(s => s.name.trim().toLowerCase()))
    for (const m of master) {
      if (db.prepare('SELECT id FROM customers WHERE gstin = ?').get(m.gstin)) continue
      if (!isGstin(m.gstin)) { log.push(`NOTE customer ${m.name}: GSTIN "${m.gstin}" is malformed — not added`); continue }
      if (supplierNames.has(m.name.trim().toLowerCase())) { log.push(`NOTE customer ${m.name}: is a supplier — not added`); continue }
      createCustomer(db, {
        name: m.name, gstin: m.gstin, pan: panFromGstin(m.gstin), phone: '', email: '',
        billing_address: m.address, billing_city: m.city, billing_state: m.state, billing_pincode: m.pincode,
        shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
      })
      log.push(`ADD  customer ${m.name} (${m.gstin})`)
      customersAdded++
    }

    // ---- Phase 3: already-imported invoices that drift from the register are re-saved to match ----
    const existing = db.prepare(`SELECT id, invoice_number FROM sales WHERE status = 'created'`).all() as { id: number; invoice_number: string }[]
    for (const { id, invoice_number: inv } of existing) {
      const header = headers.get(inv), lines = byInvoice.get(inv)
      if (!header || !lines || SHEET_WINS.has(inv)) continue
      const before = getSale(db, id)!
      // Same tolerance as the reconciliation below: a paisa of taxable is the 4-decimal rate limit.
      if (Math.abs(before.total_invoice_amount - header.sheet_total) < 0.005
        && Math.abs(before.amount - (header.register_taxable ?? 0)) < 0.015) continue
      try {
        const payload = registerMatchedPayload(db, header, lines, master, homeState, {
          maxResidualPerLine: REGISTER_WINS[inv] ? Infinity : 1
        })
        // A correction changes amounts only — the invoice keeps whatever payment it already has.
        const after = updateSale(db, id, { ...payload, payment_status: before.payment_status, payment_date: before.payment_date })
        log.push(`FIX  ${inv}: total ₹${before.total_invoice_amount} → ₹${after.total_invoice_amount} (register ₹${header.sheet_total})`)
        corrected++
      } catch (e) {
        log.push(`FAIL fix ${inv}: ${(e as Error).message}`); failed++
      }
    }

    // ---- Phase 4: invoices not yet in the app, ascending (gap-free numbering requires it) ----
    // A number the register never billed is reserved automatically as a blank bill when the
    // next invoice is created; a reserved number the sheet now fills (RP/039) is filled in place.
    const invoices = [...headers.keys()].sort((a, b) =>
      Number(a.match(/RP\/(\d+)/)![1]) - Number(b.match(/RP\/(\d+)/)![1]))
    for (const inv of invoices) {
      const header = headers.get(inv)!
      const lines = byInvoice.get(inv)
      if (db.prepare(`SELECT id FROM sales WHERE invoice_number = ? AND status = 'created'`).get(inv)) { skipped++; continue }
      if (!lines || lines.length === 0) { log.push(`SKIP ${inv}: no stock rows — stays a blank (reserved) bill`); skipped++; continue }
      try {
        const payload = registerMatchedPayload(db, header, lines, master, homeState, {
          payment: PAYMENT, maxResidualPerLine: REGISTER_WINS[inv] ? Infinity : 1
        })
        // Every FY2026-27 sale is intra-state. Refuse BEFORE writing, so a misconfigured buyer
        // state can never leave a wrongly-routed sale in the database.
        if ((payload.place_of_supply_state ?? '').trim().toLowerCase() !== homeState.trim().toLowerCase())
          throw new Error(`buyer state "${payload.place_of_supply_state}" differs from home state "${homeState}" — would book as inter-state IGST. Fix the buyer's state first.`)
        const sale = createSale(db, payload)
        if (sale.igst !== 0) throw new Error(`booked as inter-state (IGST ${sale.igst}).`)
        log.push(`ADD  ${inv}: ${payload.lines.length} lines, ${sale.total_qty_kg} kg, ₹${sale.total_invoice_amount}, ${sale.payment_status}`)
        written++
      } catch (e) {
        log.push(`FAIL ${inv}: ${(e as Error).message}`); failed++
      }
    }

    // ---- Phase 5: reconciliation, before deciding to commit ----
    const recon: string[] = []
    let mismatches = 0
    for (const inv of invoices) {
      const header = headers.get(inv)!
      if (!byInvoice.get(inv)?.length) continue
      const s = db.prepare(`SELECT * FROM sales WHERE invoice_number = ? AND status = 'created'`).get(inv) as
        { total_invoice_amount: number; amount: number } | undefined
      if (!s) { recon.push(`  MISSING ${inv}`); mismatches++; continue }
      const totalOff = Math.round((s.total_invoice_amount - header.sheet_total) * 100) / 100
      const taxableOff = Math.round((s.amount - (header.register_taxable ?? 0)) * 100) / 100
      if (SHEET_WINS.has(inv)) {
        if (totalOff !== 0) recon.push(`  NOTE ${inv}: ₹${s.total_invoice_amount} vs register ₹${header.sheet_total} — sheet wins (owner ruling)`)
        continue
      }
      // Taxable may be a paisa off where no 4-decimal rate can land exactly; the round-off still
      // brings the invoice total onto the register's.
      if (totalOff !== 0 || Math.abs(taxableOff) > 0.01) {
        recon.push(`  MISMATCH ${inv}: total ₹${s.total_invoice_amount} vs register ₹${header.sheet_total}, taxable off by ${taxableOff}`)
        mismatches++
      } else if (taxableOff !== 0) recon.push(`  NOTE ${inv}: taxable ${taxableOff > 0 ? '+' : ''}${taxableOff} vs register (4-decimal rate limit); total exact`)
    }
    for (const [key, sheetExpected] of balances) {
      const correction = SHEET_CORRECTIONS[key]
      const expected = correction ? correction.expected : sheetExpected
      if (correction) recon.push(`  NOTE lot ${key}: expecting ${expected} kg instead of the sheet's ${sheetExpected} — ${correction.why}`)
      const [code, cost] = key.split('@')
      let actual = NaN
      try {
        const itemId = resolveLotItemId(db, code, Number(cost))
        const row = db.prepare('SELECT qty_remaining_kg AS bal FROM purchase_items WHERE id = ?').get(itemId) as { bal: number }
        actual = Math.round(row.bal * 100) / 100
      } catch { /* unresolvable key falls through as NaN → mismatch */ }
      if (Math.abs(actual - expected) > 0.01) {
        recon.push(`  MISMATCH lot ${key}: sheet ${expected} kg, app ${actual} kg`)
        mismatches++
      }
    }
    const reserved = db.prepare(`SELECT invoice_number FROM sales WHERE status = 'reserved' ORDER BY seq`).all() as { invoice_number: string }[]
    recon.push(`  reserved blank bills: ${reserved.map(r => r.invoice_number).join(', ') || 'none'}`)

    const commit = COMMIT && failed === 0 && mismatches === 0
    db.exec(commit ? 'COMMIT' : 'ROLLBACK')
    closeDatabase(db)

    console.log('\n===== SALES MIGRATION ' + (commit ? '(COMMITTED)' : COMMIT ? '(ROLLED BACK — failures or mismatches)' : '(DRY RUN — rolled back)') + ' =====')
    console.log(log.join('\n'))
    console.log(`\n-- customers added ${customersAdded}; invoices added ${written}, corrected ${corrected}, already present/skipped ${skipped}, failed ${failed} --`)
    console.log('\n===== RECONCILIATION vs register and Stock sheet =====')
    console.log(recon.join('\n'))
    console.log(mismatches ? `\n${mismatches} mismatch(es)` : '\nevery invoice and lot reconciles ✅')

    expect(failed, 'some rows failed — see log above').toBe(0)
    expect(mismatches, 'some invoices or lots do not reconcile — see above').toBe(0)
  })
})
