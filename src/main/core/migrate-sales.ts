import type Database from 'better-sqlite3'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { computeSaleTax } from '@shared/tax'
import { round2, round4 } from '@shared/money'
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
  /** The register's taxable amount (its Amount column) — what the invoice's lines must add up to. */
  register_taxable?: number
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
  /** The sheet's line amount. Its rate column is display-rounded, so this is the better figure. */
  amount?: number
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
    phone: '', email: '',
    billing_address: src.address, billing_city: src.city, billing_state: src.state, billing_pincode: src.pincode,
    shipping_same: true,
    shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
  })
}

function gstRateOf(db: Database.Database, hsn: string): number {
  const row = db.prepare('SELECT gst_rate FROM hsn_products WHERE hsn_code = ?').get(hsn) as { gst_rate: number } | undefined
  return row ? row.gst_rate : 18
}

export interface PayloadOptions {
  /** Defaults to 'done', paid on the invoice date. 'pending' leaves the payment date empty. */
  payment?: 'done' | 'pending'
  /** One rate per allocation, overriding the sheet's (display-rounded) rate column. */
  rates?: number[]
}

export function buildSalePayload(
  db: Database.Database, header: SaleHeader, allocs: StockAllocation[], master: CustomerRow[], homeState: string,
  opts: PayloadOptions = {}
): NewSale {
  const buyer = resolveBuyer(db, header.buyer_gstin, header.buyer_name, master)
  const lotHsn = db.prepare('SELECT hsn_code FROM purchase_items WHERE id = ?')
  const lines: NewSaleLine[] = allocs.map((a, i) => {
    const purchase_item_id = resolveLotItemId(db, a.lot_code, a.lot_cost)
    // The lot already knows what it is; the sheet's HSN cell is sometimes blank or mistyped.
    const hsn_code = (lotHsn.get(purchase_item_id) as { hsn_code: string }).hsn_code || a.hsn_code
    return {
      purchase_item_id,
      qty_drawn_kg: a.qty,
      rate_per_kg: opts.rates ? opts.rates[i] : a.rate,
      hsn_code,
      gst_rate: gstRateOf(db, hsn_code)
    }
  })
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
    payment_status: opts.payment ?? 'done',
    payment_date: (opts.payment ?? 'done') === 'done' ? header.invoice_date : null
  }
}

const RATE_STEP = 10000   // rates carry 4 decimal places

function taxableOf(lines: { qty: number }[], units: number[]): number {
  return round2(lines.reduce((s, l, i) => s + round2((l.qty * units[i]) / RATE_STEP), 0))
}

/**
 * Exact 4-decimal rates for a sheet invoice so its lines add up to the register's taxable amount.
 * The Stock sheet shows rates and line amounts rounded for display, so taking them at face value
 * misses the register by paise to rupees. Start from each line's amount, put the leftover on the
 * largest line, then nudge one or two lines by a few 0.0001 steps until the total lands — a heavy
 * line moves in coarse steps (500 kg → 5 paise), so a lighter line often has to absorb the paise.
 * A leftover beyond `maxResidualPerLine` per line is a real disagreement, not rounding: refuse it.
 */
export function reconcileLineRates(
  lines: { qty: number; amount: number }[], target: number, maxResidualPerLine = 1
): { rates: number[]; taxable: number } {
  const base = lines.map(l => l.amount)
  const residual = round2(target - base.reduce((s, a) => s + a, 0))
  if (Math.abs(residual) > maxResidualPerLine * lines.length)
    throw new Error(`the register's taxable ₹${target} and the sheet's lines (₹${round2(target - residual)}) differ by ₹${residual}`)
  const largest = base.indexOf(Math.max(...base))
  base[largest] = base[largest] + residual
  const start = lines.map((l, i) => Math.round((base[i] / l.qty) * RATE_STEP))

  const offPaise = (u: number[]) => Math.round(Math.abs(taxableOf(lines, u) - target) * 100)
  let best = start, bestOff = offPaise(start), bestMoved = 0
  const consider = (u: number[], moved: number) => {
    const off = offPaise(u)
    if (off < bestOff || (off === bestOff && moved < bestMoved)) { best = u; bestOff = off; bestMoved = moved }
  }
  const SPAN = 30
  if (bestOff > 0)
    for (let i = 0; i < lines.length; i++)
      for (let o = -SPAN; o <= SPAN; o++) { const u = [...start]; u[i] += o; consider(u, Math.abs(o)) }
  if (bestOff > 0)
    for (let i = 0; i < lines.length; i++)
      for (let j = i + 1; j < lines.length; j++)
        for (let oi = -SPAN; oi <= SPAN; oi++)
          for (let oj = -SPAN; oj <= SPAN; oj++) {
            const u = [...start]; u[i] += oi; u[j] += oj; consider(u, Math.abs(oi) + Math.abs(oj))
          }
  return { rates: best.map(u => round4(u / RATE_STEP)), taxable: taxableOf(lines, best) }
}

/**
 * A sale payload that reproduces the register's invoice: lines from the Stock sheet (which lot,
 * how many kg), money from the register. Rates come from reconcileLineRates; the round-off is
 * whatever makes the app's total equal the register total. The app rounds CGST and SGST
 * separately where the register takes 18% in one go, so a paisa can move into the round-off —
 * but never more than a few paise, or the register and the lines genuinely disagree.
 */
export function registerMatchedPayload(
  db: Database.Database, header: SaleHeader, allocs: StockAllocation[], master: CustomerRow[], homeState: string,
  opts: { payment?: 'done' | 'pending'; maxResidualPerLine?: number } = {}
): NewSale {
  if (header.register_taxable === undefined) throw new Error(`${header.invoice_number} has no taxable amount in the register.`)
  const { rates } = reconcileLineRates(
    allocs.map(a => ({ qty: a.qty, amount: a.amount && a.amount > 0 ? a.amount : round2(a.qty * a.rate) })),
    header.register_taxable, opts.maxResidualPerLine
  )
  const payload = buildSalePayload(db, header, allocs, master, homeState, { payment: opts.payment, rates })
  const unrounded = computeSaleTax({
    lines: payload.lines, placeOfSupplyState: payload.place_of_supply_state ?? '', homeState, roundoff: 0
  })
  const roundoff = round2(header.sheet_total - unrounded.total)
  if (Math.abs(roundoff - header.roundoff) > 0.05)
    throw new Error(`${header.invoice_number}: matching the register total ₹${header.sheet_total} needs a round-off of ${roundoff}, but the register's is ${header.roundoff}.`)
  return { ...payload, roundoff }
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
    const invoice_date = mdyToISO(r[1])
    if (!invoice_date) continue   // a blank register row: the number was never billed
    const row: SaleHeader = {
      invoice_number: inv,
      invoice_date,
      buyer_name: (r[5] ?? '').trim(),
      buyer_gstin: (r[6] ?? '').trim(),
      eway_bill_no: (r[2] ?? '').trim(),
      eway_bill_date: mdyToISO(r[3]),
      vehicle: (r[4] ?? '').trim(),
      roundoff: cleanNumber(r[34]),
      sheet_total: cleanNumber(r[35]),
      register_taxable: cleanNumber(r[29])
    }
    // The register occasionally lists one invoice on two rows (one per line). It is still one
    // invoice: its amounts add up.
    const prev = out.get(inv)
    out.set(inv, prev ? {
      ...prev,
      roundoff: round2(prev.roundoff + row.roundoff),
      sheet_total: round2(prev.sheet_total + row.sheet_total),
      register_taxable: round2((prev.register_taxable ?? 0) + (row.register_taxable ?? 0))
    } : row)
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
      qty: cleanNumber(r[6]), rate: cleanNumber(r[8]), amount: cleanNumber(r[9])
    }
    if (/\/2026-27$/.test(inv)) sales.push(alloc)
    else old.push(alloc)
    balances.set(key, cleanNumber(r[10]))
  }
  return { sales, old, balances }
}
