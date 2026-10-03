// Pure helpers for the one-time purchase CSV import (see import-purchases.mjs).
// Plain ESM so both the CLI and vitest import the same code. No DB access here.

// Sign-symmetric 2-decimal rounding — mirrors src/shared/money.ts round2.
export function round2(n) {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
}

// "51,000.00" -> 51000 ; "" -> 0 ; "-1.2" -> -1.2 ; "(1.24)" -> -1.24 ; "abc" -> NaN
export function cleanNumber(s) {
  let t = String(s ?? '').replace(/[,₹\s]/g, '').trim()
  if (t === '' || t === '-') return 0   // a lone dash is the spreadsheet's accounting zero
  // Accounting-style negatives in parentheses: "(1,234.56)" -> -1234.56
  let neg = false
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1) }
  const n = Number(t)
  return Number.isFinite(n) ? (neg ? -n : n) : NaN
}

// "M/D/YYYY" -> "YYYY-MM-DD" (or null if unparseable / not a real calendar date)
export function parseDateMDY(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/)
  if (!m) return null
  const month = Number(m[1]), day = Number(m[2])
  // Accept 2-digit years from spreadsheet exports (e.g. Excel "M/D/YY"); YY -> 20YY.
  const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null
  return iso
}

// Mirrors src/main/core/financial-year.ts financialYear() (code + label only).
export function fyFromDate(iso) {
  const [y, mm] = iso.split('-')
  const year = Number(y), month = Number(mm)
  const startYear = month >= 4 ? year : year - 1
  const endYear = startYear + 1
  return { code: `${String(startYear).slice(2)}${String(endYear).slice(2)}`, label: `${startYear}-${String(endYear).slice(2)}` }
}

// Mirrors src/main/core/purchase.ts parsePurchaseSeq().
export function seqFromCode(code) {
  const m = String(code ?? '').trim().match(/^(\d+)/)
  return m ? Number(m[1]) : 0
}

// The "/NNNN" financial-year token embedded in a code like "082/2526", or '' if absent.
export function fyCodeFromCode(code) {
  const m = String(code ?? '').trim().match(/\/(\d{4})(?:\D|$)/)
  return m ? m[1] : ''
}

const norm = (h) => h.trim().toLowerCase().replace(/\.$/, '')

const HEADER_MAP = {
  'our code': 'code',
  'invoice number': 'supplier_invoice_number',
  'invoice date': 'invoice_date',
  'party': 'party',
  'description': 'description',
  'hsn code': 'hsn_code', 'hsn': 'hsn_code',
  'qty': 'qty',
  'amount': 'amount',
  'cgst': 'cgst', 'sgst': 'sgst', 'igst': 'igst', 'tcs': 'tcs',
  'r/off': 'roundoff', 'round off': 'roundoff', 'roundoff': 'roundoff',
  'total invoice amount': 'total_invoice_amount',
}

// rows (incl. header) -> { header, toImport, skipped, warnings }
export function mapPurchaseRows(rows) {
  const toImport = [], skipped = [], warnings = []
  if (rows.length === 0) return { header: [], toImport, skipped, warnings }

  let headerIdx = rows.findIndex(r => r.map(norm).some(h => HEADER_MAP[h] !== undefined))
  if (headerIdx === -1) headerIdx = 0
  const header = rows[headerIdx]
  const col = {}
  header.map(norm).forEach((h, i) => { const f = HEADER_MAP[h]; if (f && col[f] === undefined) col[f] = i })
  // The item/description column often has a blank header in exports. If it wasn't named but
  // there is an unmapped column sitting just before HSN Code, treat that column as description.
  if (col.description === undefined && col.hsn_code !== undefined) {
    const before = col.hsn_code - 1
    if (before >= 0 && !Object.values(col).includes(before)) col.description = before
  }
  const get = (r, key) => col[key] !== undefined ? (r[col[key]] ?? '').trim() : ''

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const line = i + 1
    // Some exports prefix the code cell with the literal word "Code" (e.g. "Code 082/2526");
    // strip it but keep any letter suffix ("094A/2526" stays distinct from "094/2526").
    const code = get(r, 'code').replace(/^\s*code\s+/i, '').trim()
    const party = get(r, 'party'), hsn = get(r, 'hsn_code')
    const reasons = []

    const iso = parseDateMDY(get(r, 'invoice_date'))
    if (!iso) reasons.push(`unparseable date "${get(r, 'invoice_date')}"`)
    const qty = cleanNumber(get(r, 'qty'))
    if (!(qty > 0)) reasons.push('Qty must be > 0')
    if (!code) reasons.push('missing Our Code')
    if (!party) reasons.push('missing Party')
    if (!hsn) reasons.push('missing HSN Code')
    if (iso) {
      const codeFy = fyCodeFromCode(code)
      const dateFy = fyFromDate(iso).code
      if (codeFy && codeFy !== dateFy) reasons.push(`code year ${codeFy} ≠ date year ${dateFy}`)
    }

    if (reasons.length) { skipped.push({ line, code, party, reason: reasons.join('; '), raw: r }); continue }

    const amount = cleanNumber(get(r, 'amount'))
    const cgst = cleanNumber(get(r, 'cgst')), sgst = cleanNumber(get(r, 'sgst'))
    const igst = cleanNumber(get(r, 'igst')), tcs = cleanNumber(get(r, 'tcs'))
    const roundoff = cleanNumber(get(r, 'roundoff'))
    const total_invoice_amount = cleanNumber(get(r, 'total_invoice_amount'))

    if (![amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount].every(Number.isFinite)) {
      skipped.push({ line, code, party, reason: 'Amount/tax value is not a number', raw: r })
      continue
    }

    const expected = round2(amount + cgst + sgst + igst + tcs + roundoff)
    if (Math.abs(expected - total_invoice_amount) > 1)
      warnings.push({ line, code, reason: `tax cross-check off: computed ${expected} vs sheet ${total_invoice_amount}` })

    const gst_rate = amount > 0 ? Math.round(((cgst + sgst + igst) / amount) * 100) : 18
    toImport.push({
      line, our_code: code, supplier_invoice_number: get(r, 'supplier_invoice_number'),
      invoice_date: iso, party, description: get(r, 'description'), hsn_code: hsn, gst_rate,
      qty_kg: round2(qty), rate_per_kg: round2(amount / qty), amount: round2(amount),
      cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), tcs: round2(tcs),
      roundoff: round2(roundoff), total_invoice_amount: round2(total_invoice_amount),
      fy_label: fyFromDate(iso).label, code_seq: seqFromCode(code),
    })
  }
  return { header, toImport, skipped, warnings }
}

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildSkippedCsv(header, skipped) {
  const head = [...header, 'Skip Reason'].map(csvEscape).join(',')
  if (!skipped.length) return head
  const body = skipped.map(s => [...(s.raw ?? []), s.reason].map(csvEscape).join(',')).join('\n')
  return head + '\n' + body
}

export function buildLogReport({ mode, csvPath, counts, skipped, warnings, suppliersToCreate }) {
  const lines = []
  lines.push(`Purchase import report — mode: ${mode}`)
  lines.push(`Source: ${csvPath}`)
  lines.push('')
  lines.push(`Rows read:        ${counts.read}`)
  lines.push(`Will insert:      ${counts.toInsert}`)
  lines.push(`Skip (duplicate): ${counts.duplicate}`)
  lines.push(`Skip (invalid):   ${counts.skipped}`)
  lines.push('')
  lines.push(`Suppliers to create: ${suppliersToCreate.length ? suppliersToCreate.join(', ') : '(none)'}`)
  lines.push('')
  lines.push('Skipped rows:')
  for (const s of skipped) lines.push(`  line ${s.line} · ${s.code || '(no code)'} · ${s.party || '(no party)'} · ${s.reason}`)
  if (!skipped.length) lines.push('  (none)')
  lines.push('')
  lines.push('Warnings (imported anyway):')
  for (const w of warnings) lines.push(`  line ${w.line} · ${w.code} · ${w.reason}`)
  if (!warnings.length) lines.push('  (none)')
  return lines.join('\n')
}
