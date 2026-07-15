import type Database from 'better-sqlite3'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { createCustomer, getCustomer, placeOfSupplyState } from './customers'
import type { NewSale, NewSaleLine } from './sale'

// Excel's 1900 date system: serial 25569 is 1970-01-01, and that offset already absorbs Excel's
// fictitious 1900-02-29, so plain (serial - 25569) days is correct for every date we handle.
export function excelSerialToISO(serial: number | string): string {
  const n = typeof serial === 'string' ? Number(serial) : serial
  const ms = (n - 25569) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

export interface SaleHeader {
  invoice_number: string; invoice_date: string
  buyer_name: string; buyer_gstin: string
  eway_bill_no: string; eway_bill_date: string; vehicle: string
  roundoff: number; sheet_total: number
}

const INVOICE_RE = /^RP\/\d+\/\d{4}-\d{2}$/

export function parseSaleHeaders(rows: string[][]): Map<string, SaleHeader> {
  const out = new Map<string, SaleHeader>()
  for (const r of rows) {
    const inv = (r[0] ?? '').trim()
    if (!INVOICE_RE.test(inv)) continue
    out.set(inv, {
      invoice_number: inv,
      invoice_date: excelSerialToISO(r[1]),
      buyer_name: (r[5] ?? '').trim(),
      buyer_gstin: (r[6] ?? '').trim(),
      eway_bill_no: (r[2] ?? '').trim(),
      eway_bill_date: (r[3] ?? '').trim() ? excelSerialToISO(r[3]) : '',
      vehicle: (r[4] ?? '').trim(),
      roundoff: (r[34] ?? '').trim() ? Number(r[34]) : 0,
      sheet_total: (r[35] ?? '').trim() ? Number(r[35]) : 0
    })
  }
  return out
}

export interface StockAllocation {
  invoice_number: string; lot_code: string; lot_cost: number; hsn_code: string; qty: number; rate: number
}

export function parseStockAllocations(rows: string[][], invoiceCol: number): StockAllocation[] {
  const out: StockAllocation[] = []
  let lotCode = '', lotCost = 0, lotHsn = ''
  for (const r of rows) {
    const c0 = (r[0] ?? '').trim()
    if (c0.startsWith('Code ')) {
      lotCode = c0.slice(5).trim()
      lotCost = Number(r[8] ?? 0)
      lotHsn = (r[5] ?? '').trim()
      continue
    }
    if ((r[4] ?? '').trim() !== 'Sales') continue
    const inv = (r[invoiceCol] ?? '').trim()
    if (!inv) continue
    out.push({
      invoice_number: inv, lot_code: lotCode, lot_cost: lotCost, hsn_code: lotHsn,
      qty: Number(r[6] ?? 0), rate: Number(r[8] ?? 0)
    })
  }
  return out
}

// A lot is identified by its purchase code; the cost/kg is a tie-breaker used only when one code
// covers several lots (082/2526 was imported as two purchase lines at different rates). A UNIQUE
// code resolves even when the sheet's cost disagrees with the purchase record — the two sources
// occasionally recorded different rates (094/2526: sheet 225 vs purchase 187.50), and for a
// unique code there is no ambiguity for the cost to resolve.
export function resolveLotItemId(db: Database.Database, lotCode: string, lotCost: number): number {
  const all = db.prepare(`
    SELECT i.id, i.rate_per_kg
    FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
    WHERE p.our_code = ?
  `).all(lotCode) as Array<{ id: number; rate_per_kg: number }>
  if (all.length === 0)
    throw new Error(`No lot ${lotCode} exists in the database.`)
  if (all.length === 1) return all[0].id

  const matches = all.filter(m => Math.abs(m.rate_per_kg - lotCost) <= 1)
  if (matches.length === 0)
    throw new Error(`No lot ${lotCode} at cost ~${lotCost}/kg exists in the database (the code has ${all.length} lots at other costs).`)
  if (matches.length > 1)
    throw new Error(`Lot ${lotCode} at cost ~${lotCost}/kg matches more than one lot — cannot tell them apart.`)
  return matches[0].id
}

export interface CustomerRow {
  name: string; address: string; city: string; state: string; pincode: string; gstin: string; pan: string
}

export function parseCustomerMaster(rows: string[][]): CustomerRow[] {
  const out: CustomerRow[] = []
  for (const r of rows) {
    const name = (r[1] ?? '').trim()
    if (!name || name === 'Header') continue
    if ((r[0] ?? '').trim().toLowerCase() === 'sl no') continue
    out.push({
      name,
      address: (r[2] ?? '').trim(), city: (r[3] ?? '').trim(),
      state: (r[4] ?? '').trim(), pincode: String(r[5] ?? '').replace(/\.0$/, '').trim(),
      gstin: (r[7] ?? '').trim(), pan: (r[8] ?? '').trim()
    })
  }
  return out
}

export function resolveBuyer(db: Database.Database, gstin: string, name: string, master: CustomerRow[]): Customer {
  const existing = db.prepare('SELECT id FROM customers WHERE gstin = ?').get(gstin) as { id: number } | undefined
  if (existing) return getCustomer(db, existing.id)!

  const pan = panFromGstin(gstin)
  const src =
    master.find(m => m.gstin && m.gstin === gstin) ||
    master.find(m => m.pan && m.pan === pan) ||
    master.find(m => m.name.trim().toLowerCase() === name.trim().toLowerCase())
  if (!src)
    throw new Error(`Buyer ${name} (${gstin}) is not in the app and could not find an address in CustomerMaster.`)

  return createCustomer(db, {
    name: src.name || name,
    gstin,
    pan: panFromGstin(gstin),
    phone: '',
    billing_address: src.address, billing_city: src.city, billing_state: src.state, billing_pincode: src.pincode,
    shipping_same: true,
    shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
  })
}

function gstRateOf(db: Database.Database, hsn: string): number {
  const row = db.prepare('SELECT gst_rate FROM hsn_products WHERE hsn_code = ?').get(hsn) as { gst_rate: number } | undefined
  return row ? row.gst_rate : 18
}

export function buildSalePayload(
  db: Database.Database, header: SaleHeader, allocs: StockAllocation[], master: CustomerRow[], homeState: string
): NewSale {
  const buyer = resolveBuyer(db, header.buyer_gstin, header.buyer_name, master)
  const lines: NewSaleLine[] = allocs.map(a => ({
    purchase_item_id: resolveLotItemId(db, a.lot_code, a.lot_cost),
    qty_drawn_kg: a.qty,
    rate_per_kg: a.rate,
    hsn_code: a.hsn_code,
    gst_rate: gstRateOf(db, a.hsn_code)
  }))
  const billing = {
    address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode
  }
  const shipping = buyer.shipping_same
    ? { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode }
    : { address: buyer.shipping_address, city: buyer.shipping_city, state: buyer.shipping_state, pincode: buyer.shipping_pincode }
  return {
    invoice_number: header.invoice_number,
    invoice_date: header.invoice_date,
    buyer_customer_id: buyer.id,
    buyer_name: buyer.name,
    buyer_gstin: buyer.gstin,
    buyer_billing: billing,
    buyer_shipping: shipping,
    place_of_supply_state: placeOfSupplyState(buyer),
    homeState,
    lines,
    roundoff: header.roundoff,
    eway_bill_no: header.eway_bill_no || undefined,
    eway_bill_date: header.eway_bill_date || undefined,
    vehicle: header.vehicle || undefined,
    payment_status: 'done',
    payment_date: header.invoice_date
  }
}

// ---------- CSV input layer ----------
// The owner's sheets arrive as CSV exports (the live Google Sheet is the source of truth; the
// xlsx snapshot went stale). Same row shapes, different mechanics: RFC-quoted fields, dates as
// M/D/YYYY strings, numbers formatted like "  12,900 " with "-" standing for zero.

/** Minimal RFC-4180 parser: quoted fields, embedded commas/quotes/newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

/** "  12,900 " → 12900; "  -   " (accounting zero), '#N/A' and '' → 0. */
export function cleanNumber(s: string | undefined): number {
  const t = (s ?? '').replace(/,/g, '').trim()
  if (t === '' || t === '-' || t === '#N/A') return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : 0
}

/** '4/2/2026' → '2026-04-02'. Anything unparseable (blank, #N/A) → ''. */
export function mdyToISO(s: string | undefined): string {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec((s ?? '').trim())
  if (!m) return ''
  return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

export function parseSaleHeadersCsv(rows: string[][]): Map<string, SaleHeader> {
  const out = new Map<string, SaleHeader>()
  for (const r of rows) {
    const inv = (r[0] ?? '').trim()
    if (!INVOICE_RE.test(inv)) continue
    out.set(inv, {
      invoice_number: inv,
      invoice_date: mdyToISO(r[1]),
      buyer_name: (r[5] ?? '').trim(),
      buyer_gstin: (r[6] ?? '').trim(),
      eway_bill_no: (r[2] ?? '').trim(),
      eway_bill_date: mdyToISO(r[3]),
      vehicle: (r[4] ?? '').trim(),
      roundoff: cleanNumber(r[34]),
      sheet_total: cleanNumber(r[35])
    })
  }
  return out
}

export interface ParsedStock {
  /** FY2026-27 draws — these become sale lines. */
  sales: StockAllocation[]
  /** FY2025-26 draws — consumed stock before the app; they become opening adjustments. */
  old: StockAllocation[]
  /** Each lot's final Balance cell, keyed `${lot_code}@${lot_cost}`. */
  balances: Map<string, number>
}

/**
 * Walks the CSV Stock sheet. Invoice numbers live in column 1 on Sales rows (both financial
 * years); the block structure is unchanged — a 'Code …' row opens a lot, the Sales rows under it
 * draw it down, and the last Balance cell of a block is that lot's true remaining stock.
 */
export function parseStockCsv(rows: string[][]): ParsedStock {
  const sales: StockAllocation[] = [], old: StockAllocation[] = []
  const balances = new Map<string, number>()
  let lotCode = '', lotCost = 0, lotHsn = '', key = ''
  for (const r of rows) {
    const c0 = (r[0] ?? '').trim()
    if (c0.startsWith('Code ')) {
      lotCode = c0.slice(5).trim()
      lotCost = cleanNumber(r[8])
      lotHsn = (r[5] ?? '').trim()
      key = `${lotCode}@${lotCost}`
      if (!balances.has(key)) balances.set(key, cleanNumber(r[10]))   // opening = bought, until a sale updates it
      continue
    }
    if ((r[4] ?? '').trim() !== 'Sales' || !lotCode) continue
    const inv = (r[1] ?? '').trim()
    if (!inv) continue
    const alloc: StockAllocation = {
      invoice_number: inv, lot_code: lotCode, lot_cost: lotCost, hsn_code: lotHsn,
      qty: cleanNumber(r[6]), rate: cleanNumber(r[8])
    }
    if (/\/2026-27$/.test(inv)) sales.push(alloc)
    else old.push(alloc)
    balances.set(key, cleanNumber(r[10]))
  }
  return { sales, old, balances }
}
