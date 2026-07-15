import { describe, it, expect } from 'vitest'
import { excelSerialToISO, parseSaleHeaders, parseStockAllocations } from '../../src/main/core/migrate-sales'

describe('excelSerialToISO', () => {
  it('converts known anchors', () => {
    expect(excelSerialToISO(46023)).toBe('2026-01-01')   // hand-checked anchor
    expect(excelSerialToISO(46114)).toBe('2026-04-02')   // RP/001 invoice date
  })
  it('accepts a numeric string', () => {
    expect(excelSerialToISO('46023')).toBe('2026-01-01')
  })
})

describe('parseSaleHeaders', () => {
  // columns: 0 inv, 1 date, 2 eway no, 3 eway date, 4 vehicle, 5 buyer, 6 gstin, 34 roundoff, 35 total
  const row = (over: Record<number, string>) => {
    const r = Array(38).fill('')
    return Object.assign(r, over)
  }
  const rows = [
    row({ 0: 'Invoice Number' }),                                   // header noise
    row({ 0: 'RP/001/2026-27', 1: '46114', 2: '518', 5: 'Jenisa Enterprise', 6: '19BOGPB4474J1ZQ', 34: '-0.34', 35: '18499.995' }),
    row({ 0: 'RP/002/2026-27', 1: '46115', 2: '8116 6782', 3: '46115', 4: 'WB23D1657', 5: 'SHIVAM TRADERS', 6: '19ACNPC1217E1Z0', 34: '', 35: '871725' }),
    row({ 0: '' })                                                  // blank row
  ]

  it('keys headers by invoice number and converts the date', () => {
    const m = parseSaleHeaders(rows)
    expect(m.size).toBe(2)
    expect(m.get('RP/001/2026-27')).toEqual({
      invoice_number: 'RP/001/2026-27', invoice_date: '2026-04-02',
      buyer_name: 'Jenisa Enterprise', buyer_gstin: '19BOGPB4474J1ZQ',
      eway_bill_no: '518', eway_bill_date: '', vehicle: '', roundoff: -0.34, sheet_total: 18499.995
    })
  })
  it('treats a blank round-off as zero and reads the e-way date when present', () => {
    const h = parseSaleHeaders(rows).get('RP/002/2026-27')!
    expect(h.roundoff).toBe(0)
    expect(h.eway_bill_date).toBe('2026-04-03')
    expect(h.vehicle).toBe('WB23D1657')
  })
})

describe('parseStockAllocations', () => {
  // Stock columns: 0 code/voucher, 4 kind, 5 hsn, 6 qty, 8 rate, 10 balance, 11 invoice no (new col)
  const r = (over: Record<number, string>) => Object.assign(Array(12).fill(''), over)
  const rows = [
    r({ 0: 'Stock Statement' }),                                                   // title
    r({ 0: 'Code Number', 4: 'Items' }),                                           // header
    r({ 0: 'Code 082/2526', 4: 'Purchases', 5: '320419', 6: '300', 8: '170', 10: '300' }),
    r({ 0: '647', 4: 'Sales', 5: '320419', 6: '75', 8: '172', 10: '225', 11: 'RP/001/2026-27' }),
    r({ 0: '517', 4: 'Sales', 5: '320419', 6: '25', 8: '175', 10: '200', 11: 'RP/001/2026-27' }),
    r({ 0: '999', 4: 'Sales', 5: '320419', 6: '10', 8: '170', 10: '190', 11: '' }),   // unlabelled -> skipped
    r({ 0: 'Code 082/2526', 4: 'Purchases', 5: '320419', 6: '300', 8: '102', 10: '300' }),  // 2nd lot, same code
    r({ 0: '650', 4: 'Sales', 5: '320419', 6: '100', 8: '104', 10: '200', 11: 'RP/009/2026-27' })
  ]

  it('attaches each sale to the lot block above it, with that lot cost', () => {
    const allocs = parseStockAllocations(rows, 11)
    expect(allocs).toEqual([
      { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 75, rate: 172 },
      { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 25, rate: 175 },
      { invoice_number: 'RP/009/2026-27', lot_code: '082/2526', lot_cost: 102, hsn_code: '320419', qty: 100, rate: 104 }
    ])
  })
  it('skips sale rows with no invoice number', () => {
    const allocs = parseStockAllocations(rows, 11)
    expect(allocs.some(a => a.qty === 10)).toBe(false)
  })
})
