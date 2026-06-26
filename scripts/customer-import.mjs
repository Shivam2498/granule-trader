// Pure helpers for the one-time customer CSV import (see import-customers.mjs).
// Plain ESM so both the CLI script (node) and the vitest test import the same code.

// Same GSTIN pattern the app uses (src/shared/validation.ts isGstin).
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

// CSV/TSV text -> rows of string cells. Delimiter auto-detected (comma vs tab)
// from the first line. Handles quoted fields ("a,b"), embedded "" quotes, CRLF,
// and skips blank lines.
export function parseCsv(text) {
  const clean = text.replace(/^﻿/, '')
  // Detect delimiter from the first few non-empty lines (a leading "Table 1"
  // title row from Numbers has no delimiter, so sniff several lines).
  const sniff = clean.split(/\r?\n/).filter(l => l.trim() !== '').slice(0, 5)
  let tabs = 0, commas = 0
  for (const l of sniff) { tabs += l.split('\t').length - 1; commas += l.split(',').length - 1 }
  const delim = tabs > commas ? '\t' : ','

  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i]
    if (inQuotes) {
      if (ch === '"') {
        if (clean[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === delim) {
      row.push(field); field = ''
    } else if (ch === '\n') {
      row.push(field); rows.push(row); row = []; field = ''
    } else if (ch !== '\r') {
      field += ch
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

const norm = (h) => h.trim().toLowerCase().replace(/\.$/, '')

const HEADER_MAP = {
  'customer name': 'name', 'name': 'name',
  'address': 'billing_address',
  'city': 'billing_city',
  'state': 'billing_state',
  'pincode': 'billing_pincode',
  'phone': 'phone',
  'gstin': 'gstin',
  'pan no': 'pan', 'pan': 'pan',
  // 'sl no' intentionally unmapped -> ignored
}

// rows (incl. header) -> { toImport: Omit<Customer,'id'>[], skipped: {line,name,reason}[] }.
// Name required; GSTIN optional but skipped if present-and-malformed; PAN from the
// column or derived from GSTIN; shipping mirrors billing. Every valid row is kept
// (no de-duplication).
export function mapCustomerRows(rows) {
  const toImport = [], skipped = []
  if (rows.length === 0) return { toImport, skipped }

  // Find the header row by its column names (skips a leading "Table 1" title
  // row that Numbers/Excel may prepend). Falls back to the first row.
  let headerIdx = rows.findIndex(r => r.map(norm).some(h => HEADER_MAP[h] !== undefined))
  if (headerIdx === -1) headerIdx = 0
  const header = rows[headerIdx].map(norm)
  const col = {}
  header.forEach((h, i) => { const f = HEADER_MAP[h]; if (f && col[f] === undefined) col[f] = i })
  const get = (r, key) => col[key] !== undefined ? (r[col[key]] ?? '').trim() : ''

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const line = i + 1
    const name = get(r, 'name')
    if (!name) { skipped.push({ line, name: '', reason: 'missing Customer Name' }); continue }
    const gstin = get(r, 'gstin').toUpperCase()
    if (gstin && !GSTIN_RE.test(gstin)) { skipped.push({ line, name, reason: `invalid GSTIN "${gstin}"` }); continue }
    const pan = get(r, 'pan').toUpperCase() || (gstin.length >= 12 ? gstin.slice(2, 12) : '')
    const billing_address = get(r, 'billing_address')
    const billing_city = get(r, 'billing_city')
    const billing_state = get(r, 'billing_state')
    const billing_pincode = get(r, 'billing_pincode')
    toImport.push({
      name, gstin, pan, phone: get(r, 'phone'),
      billing_address, billing_city, billing_state, billing_pincode,
      shipping_same: true,
      shipping_address: billing_address, shipping_city: billing_city,
      shipping_state: billing_state, shipping_pincode: billing_pincode,
    })
  }
  return { toImport, skipped }
}
