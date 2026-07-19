import { describe, it, expect } from 'vitest'
import {
  fyMonths, filterSalesReport, filterPurchasesReport, reportTotals,
  saleTotalRow, purchaseTotalRow, reportFilename
} from '../../src/renderer/lib/report'
import type { Sale, Purchase } from '../../src/shared/types'

const sale = (o: Partial<Sale>): Sale => ({
  id: 1, invoice_number: 'RP/001/2026-27', prefix: 'RP', seq: 1, fy_label: '2026-27', status: 'created',
  invoice_date: '2026-04-02', buyer_customer_id: 7, buyer_name: 'Jenisa', buyer_gstin: '',
  buyer_billing_json: '{}', buyer_shipping_json: '{}', place_of_supply_state: '',
  amount: 100, cgst: 9, sgst: 9, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 118,
  total_qty_kg: 10, payment_status: 'done', payment_date: null, created_at: '', eway_bill_no: null,
  eway_bill_date: null, vehicle: null, ...o
} as Sale)
const purchase = (o: Partial<Purchase>): Purchase => ({
  id: 1, our_code: '001/2627', supplier_invoice_number: '', invoice_date: '2026-04-10', party: 'Swastik',
  party_state: '', party_city: '', party_pincode: '', party_address: '', hsn_code: '320419', description: '',
  qty_kg: 100, qty_remaining_kg: 100, rate_per_kg: 120, amount: 12000, cgst: 1080, sgst: 1080, igst: 0,
  tcs: 0, roundoff: 0, total_invoice_amount: 14160, payment_status: 'pending', payment_date: null,
  eway_bill_no: '', eway_bill_date: '', vehicle: '',
  fy_label: '2026-27', code_seq: 1, created_at: '', supplier_id: 3, ...o
} as Purchase)

describe('fyMonths', () => {
  it('lists Apr through Mar with year-crossing keys', () => {
    const m = fyMonths('2026-27')
    expect(m).toHaveLength(12)
    expect(m[0]).toEqual({ value: '2026-04', label: 'Apr 2026' })
    expect(m[9]).toEqual({ value: '2027-01', label: 'Jan 2027' })
    expect(m[11]).toEqual({ value: '2027-03', label: 'Mar 2027' })
  })
})

describe('filterSalesReport', () => {
  const rows = [
    sale({ id: 1, seq: 2, invoice_date: '2026-05-10', buyer_customer_id: 7 }),
    sale({ id: 2, seq: 1, invoice_date: '2026-04-02', buyer_customer_id: 7 }),
    sale({ id: 3, seq: 3, invoice_date: '2026-04-05', buyer_customer_id: 9 }),   // other buyer
    sale({ id: 4, seq: 4, status: 'reserved', invoice_date: null, buyer_customer_id: 7 })  // blank
  ]
  it('keeps only the buyer’s issued invoices, oldest first', () => {
    expect(filterSalesReport(rows, 7).map(s => s.id)).toEqual([2, 1])
  })
  it('narrows to a month', () => {
    expect(filterSalesReport(rows, 7, '2026-04').map(s => s.id)).toEqual([2])
  })
})

describe('filterPurchasesReport', () => {
  const rows = [
    purchase({ id: 1, code_seq: 2, invoice_date: '2026-05-01', supplier_id: 3 }),
    purchase({ id: 2, code_seq: 1, invoice_date: '2026-04-10', supplier_id: 3 }),
    purchase({ id: 3, invoice_date: '2026-04-11', supplier_id: 5 })
  ]
  it('keeps only the supplier’s bills, oldest first, with month filter', () => {
    expect(filterPurchasesReport(rows, 3).map(p => p.id)).toEqual([2, 1])
    expect(filterPurchasesReport(rows, 3, '2026-05').map(p => p.id)).toEqual([1])
  })
})

describe('reportTotals', () => {
  it('sums the six figures with 2-dp rounding', () => {
    const t = reportTotals([
      saleTotalRow(sale({ total_qty_kg: 10.005, amount: 0.1, cgst: 0.2, sgst: 0.2, igst: 0, total_invoice_amount: 0.5 })),
      saleTotalRow(sale({ total_qty_kg: 5, amount: 0.2, cgst: 0.1, sgst: 0.1, igst: 0, total_invoice_amount: 0.5 }))
    ])
    expect(t).toEqual({ qty: 15.01, taxable: 0.3, cgst: 0.3, sgst: 0.3, igst: 0, total: 1 })
  })
  it('adapts purchases too', () => {
    expect(purchaseTotalRow(purchase({}))).toEqual({ qty: 100, taxable: 12000, cgst: 1080, sgst: 1080, igst: 0, total: 14160 })
  })
})

describe('reportFilename', () => {
  it('slugs the party and appends the period', () => {
    expect(reportFilename('Sales', 'Jenisa Enterprise', '2026-27')).toBe('Sales-Jenisa-Enterprise-2026-27.csv')
    expect(reportFilename('Purchases', 'S.M ENGINEERING & CO', '2026-27', 'Apr 2026')).toBe('Purchases-S-M-ENGINEERING-CO-Apr-2026.csv')
  })
})
