import { describe, it, expect } from 'vitest'
import { cleanNumber, parseDateMDY, fyFromDate, seqFromCode, fyCodeFromCode, round2, mapPurchaseRows, buildSkippedCsv, buildLogReport } from '../../scripts/purchase-import.mjs'
import { parseCsv } from '../../scripts/customer-import.mjs'

describe('cleanNumber', () => {
  it('strips thousands commas', () => { expect(cleanNumber('51,000.00')).toBe(51000) })
  it('treats blank as zero', () => { expect(cleanNumber('')).toBe(0) })
  it('keeps negatives', () => { expect(cleanNumber('-1.2')).toBe(-1.2) })
  it('returns NaN for non-numeric', () => { expect(Number.isNaN(cleanNumber('abc'))).toBe(true) })
})

describe('parseDateMDY', () => {
  it('parses M/D/YYYY', () => { expect(parseDateMDY('1/12/2026')).toBe('2026-01-12') })
  it('pads single digits', () => { expect(parseDateMDY('4/1/2025')).toBe('2025-04-01') })
  it('rejects an impossible date', () => { expect(parseDateMDY('2/30/2025')).toBe(null) })
  it('rejects garbage', () => { expect(parseDateMDY('not a date')).toBe(null) })
})

describe('fyFromDate', () => {
  it('April starts a new FY', () => { expect(fyFromDate('2025-04-01')).toEqual({ code: '2526', label: '2025-26' }) })
  it('March is the prior FY', () => { expect(fyFromDate('2026-03-31')).toEqual({ code: '2526', label: '2025-26' }) })
  it('next FY', () => { expect(fyFromDate('2026-04-01')).toEqual({ code: '2627', label: '2026-27' }) })
})

describe('seqFromCode / fyCodeFromCode', () => {
  it('reads the leading sequence', () => { expect(seqFromCode('082/2526')).toBe(82) })
  it('reads the FY token', () => { expect(fyCodeFromCode('082/2526')).toBe('2526') })
  it('missing token → empty', () => { expect(fyCodeFromCode('82')).toBe('') })
})

describe('round2', () => {
  it('rounds symmetrically', () => { expect(round2(-1.005)).toBe(-1.01); expect(round2(1.005)).toBe(1.01) })
})

const HEADER = 'Our Code,Invoice Number,Invoice Date,Party,Description,HSN Code,Qty,Amount,CGST,SGST,IGST,TCS,Total,R/Off,Total Invoice Amount'
const GOOD = '082/2526,SPL/25-26/3079,1/12/2026,SWASTIK,Black M/B,320419,300,"51,000.00","4,590.00","4,590.00",,,"9,180.00",,"60,180.00"'

describe('mapPurchaseRows', () => {
  it('maps a valid row and trusts the sheet tax values', () => {
    const { toImport, skipped, warnings } = mapPurchaseRows(parseCsv(`${HEADER}\n${GOOD}\n`))
    expect(skipped).toEqual([])
    expect(warnings).toEqual([])
    expect(toImport).toHaveLength(1)
    expect(toImport[0]).toMatchObject({
      our_code: '082/2526', invoice_date: '2026-01-12', party: 'SWASTIK', description: 'Black M/B',
      hsn_code: '320419', qty_kg: 300, amount: 51000, cgst: 4590, sgst: 4590, igst: 0, tcs: 0,
      roundoff: 0, total_invoice_amount: 60180, rate_per_kg: 170, gst_rate: 18,
      fy_label: '2025-26', code_seq: 82,
    })
  })

  it('skips an unparseable date and a non-positive qty, keeping the raw row', () => {
    const bad = '083/2526,X,not-a-date,ACME,Nat,3902,0,100,,,,,,,100'
    const { toImport, skipped } = mapPurchaseRows(parseCsv(`${HEADER}\n${bad}\n`))
    expect(toImport).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toMatch(/date/)
    expect(skipped[0].reason).toMatch(/Qty/)
    expect(skipped[0].raw[0]).toBe('083/2526')
  })

  it('skips a row whose code year disagrees with its date year', () => {
    // code says 2526 (FY 2025-26) but date is in FY 2026-27
    const mism = '090/2526,X,4/1/2026,ACME,Nat,3902,10,100,,,,,,,100'
    const { skipped } = mapPurchaseRows(parseCsv(`${HEADER}\n${mism}\n`))
    expect(skipped[0].reason).toMatch(/code year 2526 . date year 2627/)
  })

  it('warns (but still imports) when the tax cross-check is off by more than a rupee', () => {
    const off = '091/2526,X,1/5/2026,ACME,Nat,3902,10,1000,90,90,,,,,2000'
    const { toImport, warnings } = mapPurchaseRows(parseCsv(`${HEADER}\n${off}\n`))
    expect(toImport).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].reason).toMatch(/cross-check/)
  })
})

describe('buildSkippedCsv', () => {
  it('reproduces original columns plus a Skip Reason column', () => {
    const header = ['Our Code', 'Party']
    const skipped = [{ line: 3, code: '9', party: 'A, B', reason: 'bad date', raw: ['9', 'A, B'] }]
    expect(buildSkippedCsv(header, skipped)).toBe('Our Code,Party,Skip Reason\n9,"A, B",bad date')
  })
})

describe('buildLogReport', () => {
  it('includes the mode, counts, and each skip reason', () => {
    const text = buildLogReport({
      mode: 'dry-run', csvPath: 'p.csv',
      counts: { read: 2, toInsert: 1, duplicate: 0, skipped: 1 },
      skipped: [{ line: 3, code: '9', party: 'A', reason: 'bad date' }],
      warnings: [], suppliersToCreate: ['A'],
    })
    expect(text).toMatch(/dry-run/)
    expect(text).toMatch(/line 3 · 9 · A · bad date/)
    expect(text).toMatch(/Suppliers to create: A/)
  })
})
