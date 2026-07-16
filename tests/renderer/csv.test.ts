import { describe, it, expect } from 'vitest'
import { toCsv, salesColumns, purchaseColumns } from '../../src/renderer/lib/csv'
import type { Sale, Purchase } from '../../src/shared/types'

describe('toCsv', () => {
  it('joins headers and rows, escaping quotes/commas/newlines', () => {
    const cols = [
      { header: 'Name', value: (r: { n: string; v: number }) => r.n },
      { header: 'Val', value: (r: { n: string; v: number }) => r.v },
    ]
    const out = toCsv([{ n: 'Plain', v: 1 }, { n: 'Has, comma', v: 2 }, { n: 'Quote"x', v: 3 }, { n: 'line1\nline2', v: 4 }], cols)
    expect(out).toBe('Name,Val\nPlain,1\n"Has, comma",2\n"Quote""x",3\n"line1\nline2",4')
    expect(out).toContain('"line1\nline2"')
  })
  it('escapes cells containing a carriage return', () => {
    const cols = [{ header: 'V', value: (r: { v: string }) => r.v }]
    expect(toCsv([{ v: 'a\rb' }], cols)).toBe('V\n"a\rb"')
  })
  it('neutralises formula-injection: values starting with = + - @ are prefixed with single-quote', () => {
    const cols = [{ header: 'Val', value: (r: { v: string }) => r.v }]
    const out = toCsv([{ v: '=HYPERLINK("x")' }], cols)
    // cell must be quoted and start with the ' guard character
    expect(out).toBe("Val\n\"'=HYPERLINK(\"\"x\"\")\"")
    expect(out).toContain("'=HYPERLINK")
  })
  it('does not corrupt negative numbers (they are values, not formulas)', () => {
    const cols = [{ header: 'Round-off', value: (r: { v: number }) => r.v }]
    // A negative numeric value must export as a plain number, NOT a quoted apostrophe-prefixed text cell.
    expect(toCsv([{ v: -1.2 }], cols)).toBe('Round-off\n-1.2')
  })
  it('still guards a string that starts with a minus sign', () => {
    const cols = [{ header: 'V', value: (r: { v: string }) => r.v }]
    expect(toCsv([{ v: '-1+2' }], cols)).toBe("V\n\"'-1+2\"")
  })
  it('returns just the header row for no data', () => {
    expect(toCsv([], [{ header: 'A', value: () => '' }])).toBe('A')
  })
})

describe('salesColumns', () => {
  it('maps invoice-level GST fields and reads buyer state from JSON', () => {
    const s = { invoice_number: 'RP/1', invoice_date: '2026-06-10', buyer_name: 'Acme', buyer_gstin: '24X',
      buyer_billing_json: '{"state":"Gujarat"}', total_qty_kg: 5, amount: 100, cgst: 9, sgst: 9, igst: 0, tcs: 0,
      roundoff: 0, total_invoice_amount: 118, payment_status: 'pending', payment_date: null } as Sale
    const row = salesColumns.map(c => c.value(s))
    expect(row).toEqual(['RP/1', '10/06/2026', 'Acme', '24X', 'Gujarat', 5, 100, 9, 9, 0, 0, 0, 118, 'pending', ''])
    expect(salesColumns.map(c => c.header)).toContain('Buyer GSTIN')
  })
})

describe('purchaseColumns', () => {
  it('maps purchase GST fields including HSN and Round-off', () => {
    const p = { our_code: 'P1', supplier_invoice_number: 'S1', invoice_date: '2026-06-10', party: 'Supp',
      party_state: 'Gujarat', hsn_code: '3901', qty_kg: 10, rate_per_kg: 50, amount: 500, cgst: 45, sgst: 45,
      igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 590, payment_status: 'done', payment_date: '2026-06-12' } as Purchase
    const row = purchaseColumns.map(c => c.value(p))
    expect(row).toEqual(['P1', 'S1', '10/06/2026', 'Supp', 'Gujarat', '3901', 10, 50, 500, 45, 45, 0, 0, 0, 590, 'done', '12/06/2026'])
    expect(purchaseColumns.map(c => c.header)).toContain('Round-off')
  })
  it('emits empty string for a null invoice date', () => {
    const p = { our_code: 'P1', supplier_invoice_number: 'S1', invoice_date: null as any, party: 'Supp',
      party_state: 'Gujarat', hsn_code: '3901', qty_kg: 10, rate_per_kg: 50, amount: 500, cgst: 45, sgst: 45,
      igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 590, payment_status: 'done', payment_date: '2026-06-12' } as Purchase
    const dateIdx = purchaseColumns.findIndex(c => c.header === 'Date')
    expect(purchaseColumns[dateIdx].value(p)).toBe('')
  })
})
