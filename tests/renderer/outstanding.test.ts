import { describe, it, expect } from 'vitest'
import { receivablesByParty, payablesByParty } from '../../src/renderer/lib/outstanding'
import type { Sale, Purchase } from '../../src/shared/types'

const TODAY = '2026-07-19'

const sale = (o: Partial<Sale>): Sale => ({
  id: 1, invoice_number: 'RP/001/2026-27', prefix: 'RP', seq: 1, fy_label: '2026-27', status: 'created',
  invoice_date: '2026-07-01', buyer_customer_id: 7, buyer_name: 'Jenisa', buyer_gstin: '',
  buyer_billing_json: '{}', buyer_shipping_json: '{}', place_of_supply_state: '',
  amount: 100, cgst: 9, sgst: 9, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 118,
  total_qty_kg: 10, payment_status: 'pending', payment_date: null, created_at: '', eway_bill_no: null,
  eway_bill_date: null, vehicle: null, ...o
} as Sale)
const purchase = (o: Partial<Purchase>): Purchase => ({
  id: 1, our_code: '001/2627', supplier_invoice_number: '', invoice_date: '2026-07-01', party: 'Swastik',
  party_state: '', party_city: '', party_pincode: '', party_address: '', hsn_code: '320419', description: '',
  qty_kg: 100, qty_remaining_kg: 100, rate_per_kg: 120, amount: 12000, cgst: 1080, sgst: 1080, igst: 0,
  tcs: 0, roundoff: 0, total_invoice_amount: 14160, payment_status: 'pending', payment_date: null,
  eway_bill_no: '', eway_bill_date: '', vehicle: '',
  fy_label: '2026-27', code_seq: 1, created_at: '', supplier_id: 3, ...o
} as Purchase)

describe('receivablesByParty', () => {
  it('groups unpaid sales by buyer, ages them, and sorts by total', () => {
    const r = receivablesByParty([
      sale({ id: 1, buyer_customer_id: 7, buyer_name: 'Jenisa', invoice_date: '2026-07-10', total_invoice_amount: 5900 }), // 9d → 0-30
      sale({ id: 2, buyer_customer_id: 7, buyer_name: 'Jenisa', invoice_date: '2026-05-10', total_invoice_amount: 100 }),  // 70d → 60+
      sale({ id: 3, buyer_customer_id: 9, buyer_name: 'Acme',   invoice_date: '2026-06-10', total_invoice_amount: 12000 }),// 39d → 31-60
      sale({ id: 4, buyer_customer_id: 5, buyer_name: 'Paid',   payment_status: 'done', total_invoice_amount: 999 }),      // excluded
      sale({ id: 5, buyer_customer_id: 5, buyer_name: 'Draft',  status: 'reserved', invoice_date: null }),                 // excluded
    ], TODAY)
    expect(r.total).toBe(18000)
    expect(r.rows.map(x => x.name)).toEqual(['Acme', 'Jenisa'])  // 12000 before 6000
    const jenisa = r.rows.find(x => x.name === 'Jenisa')!
    expect(jenisa).toMatchObject({ id: 7, count: 2, b0_30: 5900, b31_60: 0, b60plus: 100, total: 6000, oldestDays: 70 })
    expect(r.rows.find(x => x.name === 'Acme')).toMatchObject({ b31_60: 12000, total: 12000 })
  })
  it('is empty when nothing is outstanding', () => {
    expect(receivablesByParty([sale({ payment_status: 'done' })], TODAY)).toEqual({ rows: [], total: 0 })
  })
})

describe('payablesByParty', () => {
  it('groups unpaid purchases by supplier', () => {
    const r = payablesByParty([
      purchase({ id: 1, supplier_id: 3, party: 'Swastik', invoice_date: '2026-07-15', total_invoice_amount: 14160 }), // 4d
      purchase({ id: 2, supplier_id: 4, party: 'SM Co',   invoice_date: '2026-04-15', total_invoice_amount: 500, payment_status: 'done' }), // excluded
    ], TODAY)
    expect(r.total).toBe(14160)
    expect(r.rows).toHaveLength(1)
    expect(r.rows[0]).toMatchObject({ id: 3, name: 'Swastik', count: 1, b0_30: 14160, total: 14160 })
  })
})
