import { describe, it, expect } from 'vitest'
import {
  excelSerialToISO, parseSaleHeaders, parseStockAllocations, resolveLotItemId, parseCustomerMaster,
  resolveBuyer, buildSalePayload, parseCsv, cleanNumber, mdyToISO, parseSaleHeadersCsv, parseStockCsv
} from '../../src/main/core/migrate-sales'
import { openDatabase } from '../../src/main/db/connection'
import { createCustomer } from '../../src/main/core/customers'
import { createPurchase } from '../../src/main/core/purchase'
import { createSale, getAllocations } from '../../src/main/core/sale'

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

function seedLot(db: ReturnType<typeof openDatabase>, code: string, cost: number, hsn = '320419', qty = 300) {
  const p = db.prepare(`INSERT INTO purchases (our_code, invoice_date, hsn_code, qty_kg, qty_remaining_kg, rate_per_kg, fy_label, code_seq)
    VALUES (?, '2026-02-01', ?, ?, ?, ?, '2025-26', 82)`).run(code, hsn, qty, qty, cost)
  db.prepare(`INSERT INTO purchase_items (purchase_id, hsn_code, description, qty_kg, qty_remaining_kg, rate_per_kg, amount, gst_rate, line_no)
    VALUES (?, ?, '', ?, ?, ?, ?, 18, 1)`).run(p.lastInsertRowid, hsn, qty, qty, cost, qty * cost)
  return db.prepare('SELECT id FROM purchase_items WHERE purchase_id = ?').get(p.lastInsertRowid) as { id: number }
}

describe('resolveLotItemId', () => {
  it('disambiguates two lots that share a code by their cost', () => {
    const db = openDatabase(':memory:')
    const a = seedLot(db, '082/2526', 170)
    const b = seedLot(db, '082/2526', 102)
    expect(resolveLotItemId(db, '082/2526', 170)).toBe(a.id)
    expect(resolveLotItemId(db, '082/2526', 102)).toBe(b.id)
  })
  it('matches cost within a rupee (sheet rounding)', () => {
    const db = openDatabase(':memory:')
    const a = seedLot(db, '090/2526', 148)
    expect(resolveLotItemId(db, '090/2526', 148.31)).toBe(a.id)
  })
  it('resolves a UNIQUE code even when the sheet cost disagrees with the purchase record', () => {
    // Real case: 094/2526 — sheet says 225/kg, the purchase import recorded 187.50/kg.
    const db = openDatabase(':memory:')
    const a = seedLot(db, '094/2526', 187.5)
    expect(resolveLotItemId(db, '094/2526', 225)).toBe(a.id)
  })
  it('throws when the code does not exist at all', () => {
    const db = openDatabase(':memory:')
    seedLot(db, '090/2526', 148)
    expect(() => resolveLotItemId(db, '099/9999', 148)).toThrow(/no lot/i)
  })
  it('still requires a cost match when the code covers several lots', () => {
    const db = openDatabase(':memory:')
    seedLot(db, '082/2526', 170)
    seedLot(db, '082/2526', 102)
    expect(() => resolveLotItemId(db, '082/2526', 999)).toThrow(/no lot/i)
  })
  it('throws when the match is ambiguous', () => {
    const db = openDatabase(':memory:')
    seedLot(db, '070/2526', 100)
    seedLot(db, '070/2526', 100)
    expect(() => resolveLotItemId(db, '070/2526', 100)).toThrow(/more than one/i)
  })
})

describe('parseCustomerMaster', () => {
  const r = (over: Record<number, string>) => Object.assign(Array(9).fill(''), over)
  it('reads name/address/city/state/pincode/gstin/pan and skips blank rows', () => {
    const rows = [
      r({ 0: 'Sl No', 1: 'Header' }),
      r({ 0: '88', 1: 'Jenisa Enterprise', 2: '1129 Canning Road', 3: 'Kolkata', 4: 'West Bengal', 5: '700144', 7: '19BOGPB4474J1ZQ', 8: 'BOGPB4474J' }),
      r({ 0: '', 1: '' })
    ]
    const cs = parseCustomerMaster(rows)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ name: 'Jenisa Enterprise', city: 'Kolkata', state: 'West Bengal', pincode: '700144', gstin: '19BOGPB4474J1ZQ' })
  })
})

describe('resolveBuyer', () => {
  const master = [
    { name: 'Jenisa Enterprise', address: '1129 Canning Road', city: 'Kolkata', state: 'West Bengal', pincode: '700144', gstin: '19BOGPB4474J1ZQ', pan: 'BOGPB4474J' },
    { name: 'S.M ENGINEERING & CO', address: '91/S Majlish Ara Road', city: 'Kolkata', state: 'West Bengal', pincode: '700041', gstin: '', pan: 'AIUPM2937N' }
  ]

  it('returns an existing app customer matched by GSTIN', () => {
    const db = openDatabase(':memory:')
    const existing = createCustomer(db, {
      name: 'Jenisa Enterprise', gstin: '19BOGPB4474J1ZQ', pan: 'BOGPB4474J', phone: '', email: '',
      billing_address: 'x', billing_city: 'Kolkata', billing_state: 'West Bengal', billing_pincode: '700144',
      shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
    })
    const got = resolveBuyer(db, '19BOGPB4474J1ZQ', 'Jenisa Enterprise', master)
    expect(got.id).toBe(existing.id)
  })

  it('creates a missing buyer from CustomerMaster (GSTIN match)', () => {
    const db = openDatabase(':memory:')
    const got = resolveBuyer(db, '19BOGPB4474J1ZQ', 'Jenisa Enterprise', master)
    expect(got.id).toBeGreaterThan(0)
    expect(got.billing_city).toBe('Kolkata')
    expect(got.billing_state).toBe('West Bengal')
    expect(got.pan).toBe('BOGPB4474J')          // derived from GSTIN
  })

  it('creates a missing buyer whose CustomerMaster row has no GSTIN, matched by PAN inside the GSTIN', () => {
    const db = openDatabase(':memory:')
    const got = resolveBuyer(db, '19AIUPM2937N1ZA', 'S.M ENGINEERING & CO', master)
    expect(got.billing_pincode).toBe('700041')
    expect(got.gstin).toBe('19AIUPM2937N1ZA')
  })

  it('throws when the buyer is nowhere to be found', () => {
    const db = openDatabase(':memory:')
    expect(() => resolveBuyer(db, '19ZZZZZ0000Z1ZZ', 'Nobody Ltd', master)).toThrow(/could not find an address/i)
  })

  it('creates a missing buyer whose CustomerMaster row has no GSTIN or matching PAN, matched by name case-insensitively', () => {
    const db = openDatabase(':memory:')
    const nameOnlyMaster = [
      ...master,
      { name: 'Nayan Traders', address: '12 Park Street', city: 'Kolkata', state: 'West Bengal', pincode: '700016', gstin: '', pan: '' }
    ]
    const got = resolveBuyer(db, '19NAYAN1234N1ZB', 'NAYAN TRADERS', nameOnlyMaster)
    expect(got.billing_address).toBe('12 Park Street')
    expect(got.billing_city).toBe('Kolkata')
    expect(got.billing_state).toBe('West Bengal')
    expect(got.billing_pincode).toBe('700016')
    expect(got.gstin).toBe('19NAYAN1234N1ZB')
  })
})

describe('buildSalePayload + createSale (end to end)', () => {
  function seed(db: ReturnType<typeof openDatabase>) {
    db.prepare(`INSERT INTO hsn_products (hsn_code, description, gst_rate) VALUES ('320419','MB',18)`).run()
    // one purchase, one lot of 300 kg at cost 170
    createPurchase(db, {
      our_code: '082/2526', supplier_invoice_number: 'S', invoice_date: '2026-02-01',
      party: 'Swastik', party_state: 'West Bengal', homeState: 'West Bengal',
      items: [{ hsn_code: '320419', qty_kg: 300, rate_per_kg: 170, gst_rate: 18 }]
    })
  }
  const header = {
    invoice_number: 'RP/001/2026-27', invoice_date: '2026-04-02',
    buyer_name: 'Jenisa Enterprise', buyer_gstin: '19BOGPB4474J1ZQ',
    eway_bill_no: '518', eway_bill_date: '', vehicle: '', roundoff: -0.25, sheet_total: 17224.75
  }
  const master = [{ name: 'Jenisa Enterprise', address: 'A', city: 'Kolkata', state: 'West Bengal', pincode: '700144', gstin: '19BOGPB4474J1ZQ', pan: 'BOGPB4474J' }]
  const allocs = [
    { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 75, rate: 172 },
    { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 25, rate: 175 }
  ]

  it('produces a payload whose sale draws the exact lots and quantities', () => {
    const db = openDatabase(':memory:'); seed(db)
    const payload = buildSalePayload(db, header, allocs, master, 'West Bengal')
    expect(payload.invoice_number).toBe('RP/001/2026-27')
    expect(payload.payment_status).toBe('done')
    expect(payload.payment_date).toBe('2026-04-02')
    expect(payload.lines).toHaveLength(2)
    expect(payload.lines.map(l => [l.qty_drawn_kg, l.rate_per_kg])).toEqual([[75, 172], [25, 175]])

    const sale = createSale(db, payload)
    expect(sale.total_qty_kg).toBe(100)
    // 75*172 + 25*175 = 12900 + 4375 = 17275 taxable
    expect(sale.amount).toBe(17275)
    // lot drawn down exactly 100 kg from 300
    const rem = db.prepare(`SELECT qty_remaining_kg FROM purchase_items`).get() as { qty_remaining_kg: number }
    expect(rem.qty_remaining_kg).toBe(200)
    expect(getAllocations(db, sale.id)).toHaveLength(2)
    expect(sale.cgst).toBe(1554.75)      // 9% of 17275 — intra-state routing engaged
    expect(sale.sgst).toBe(1554.75)
    expect(sale.igst).toBe(0)
    expect(sale.total_invoice_amount).toBe(20384.25)   // 17275 + 1554.75 + 1554.75 - 0.25
    expect(sale.payment_status).toBe('done')
  })
})

describe('CSV input layer', () => {
  it('parseCsv handles quoted fields with commas and preserves empties', () => {
    const rows = parseCsv('a,"1,234.00",c\n,x,\n"q ""z""",,')
    expect(rows[0]).toEqual(['a', '1,234.00', 'c'])
    expect(rows[1]).toEqual(['', 'x', ''])
    expect(rows[2]).toEqual(['q "z"', '', ''])
  })

  it('cleanNumber strips commas, spaces, treats "-" and #N/A as zero', () => {
    expect(cleanNumber('  12,900 ')).toBe(12900)
    expect(cleanNumber('  -   ')).toBe(0)
    expect(cleanNumber('#N/A')).toBe(0)
    expect(cleanNumber('  -0.34 ')).toBe(-0.34)
    expect(cleanNumber('')).toBe(0)
  })

  it('mdyToISO converts M/D/YYYY and rejects garbage', () => {
    expect(mdyToISO('4/2/2026')).toBe('2026-04-02')
    expect(mdyToISO('12/31/2025')).toBe('2025-12-31')
    expect(mdyToISO('#N/A')).toBe('')
    expect(mdyToISO('')).toBe('')
  })
})

describe('parseSaleHeadersCsv', () => {
  const row = (over: Record<number, string>) => Object.assign(Array(39).fill(''), over)
  it('reads headers from the CSV register (M/D/YYYY dates, formatted numbers)', () => {
    const rows = [
      row({ 0: 'Invoice Number' }),
      row({ 0: 'RP/001/2026-27', 1: '4/2/2026', 4: 'WB972889', 5: 'Jenisa Enterprise', 6: '19BOGPB4474J1ZQ', 34: '  -0.34 ', 35: '  18,500.00 ' }),
      row({ 0: 'RP/002/2026-27', 1: '4/3/2026', 2: '8116 6782 6962', 3: '4/3/2026', 5: 'SHIVAM TRADERS', 6: '19ACNPC1217E1Z0', 35: '  871,725.00 ' })
    ]
    const m = parseSaleHeadersCsv(rows)
    expect(m.size).toBe(2)
    expect(m.get('RP/001/2026-27')).toMatchObject({
      invoice_date: '2026-04-02', buyer_gstin: '19BOGPB4474J1ZQ', vehicle: 'WB972889',
      eway_bill_no: '', eway_bill_date: '', roundoff: -0.34, sheet_total: 18500
    })
    expect(m.get('RP/002/2026-27')).toMatchObject({ eway_bill_date: '2026-04-03', roundoff: 0, sheet_total: 871725 })
  })
})

describe('parseStockCsv', () => {
  const r = (over: Record<number, string>) => Object.assign(Array(11).fill(''), over)
  const rows = [
    r({ 0: 'Stock Statement' }),
    r({ 0: 'Code Number', 1: 'Invoice Number' }),
    r({ 0: 'Code 082/2526', 1: 'SPL/25-26/3054', 4: 'Purchases', 5: '320419', 6: '  300.00 ', 8: '  170.00 ', 10: '  300.00 ' }),
    r({ 1: 'RP/243/2025-26', 4: 'Sales', 5: '320419', 6: '75', 8: '  172.00 ', 10: '  225.00 ' }),
    r({ 1: 'RP/001/2026-27', 2: '4/2/2026', 3: 'Jenisa Enterprise', 4: 'Sales', 5: '320419', 6: '25', 8: '  175.00 ', 10: '  200.00 ' }),
    r({}),  // blank separator
    r({ 0: 'Code 103/2526', 1: 'DO250', 4: 'Purchases', 5: '39021000', 6: '  5,000 ', 8: '  147.31 ', 10: '  5,000 ' }),
    r({ 1: 'RP/002/2026-27', 4: 'Sales', 5: '39021000', 6: '5000', 8: '  148.50 ', 10: '  -   ' })
  ]

  it('splits FY26-27 sales from FY25-26 draws, both carrying their lot', () => {
    const { sales, old } = parseStockCsv(rows)
    expect(sales).toEqual([
      { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 25, rate: 175 },
      { invoice_number: 'RP/002/2026-27', lot_code: '103/2526', lot_cost: 147.31, hsn_code: '39021000', qty: 5000, rate: 148.5 }
    ])
    expect(old).toEqual([
      { invoice_number: 'RP/243/2025-26', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 75, rate: 172 }
    ])
  })

  it('reports each lot\'s final sheet balance keyed by code@cost', () => {
    const { balances } = parseStockCsv(rows)
    expect(balances.get('082/2526@170')).toBe(200)
    expect(balances.get('103/2526@147.31')).toBe(0)   // the "-" cell
  })
})
