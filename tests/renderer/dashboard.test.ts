import { describe, it, expect } from 'vitest'
import { daysBetween, parseState, monthlyTrend, receivables, payables, gstSnapshot, monthDelta } from '../../src/renderer/lib/dashboard'
import type { Sale, Purchase } from '../../src/shared/types'

// Minimal builders — only the fields the functions read.
function sale(p: Partial<Sale>): Sale {
  return {
    id: 1, invoice_number: 'RP/1', prefix: 'RP', seq: 1, fy_label: '2026-27', status: 'created',
    invoice_date: '2026-06-10', eway_bill_no: null, eway_bill_date: null, vehicle: null,
    buyer_customer_id: null, buyer_name: 'Acme', buyer_gstin: '', buyer_billing_json: '{}', buyer_shipping_json: '{}',
    amount: 0, cgst: 0, sgst: 0, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 0, total_qty_kg: 0,
    payment_status: 'pending', payment_date: null, created_at: '', ...p
  } as Sale
}
function purchase(p: Partial<Purchase>): Purchase {
  return {
    id: 1, our_code: 'P1', supplier_invoice_number: 'S1', invoice_date: '2026-06-10', party: 'Supp',
    party_state: 'Gujarat', party_city: '', party_pincode: '', party_address: '', hsn_code: '3901',
    qty_kg: 0, qty_remaining_kg: 0, rate_per_kg: 0, amount: 0, cgst: 0, sgst: 0, igst: 0, tcs: 0,
    total_invoice_amount: 0, payment_status: 'pending', payment_date: null, ...p
  } as Purchase
}

describe('daysBetween', () => {
  it('counts whole days, sign reflects past vs future', () => {
    expect(daysBetween('2026-06-10', '2026-06-13')).toBe(3)
    expect(daysBetween('2026-06-13', '2026-06-13')).toBe(0)
    expect(daysBetween('2026-06-15', '2026-06-13')).toBe(-2)
  })
})

describe('parseState', () => {
  it('reads state from the billing JSON, empty on bad input', () => {
    expect(parseState('{"state":"Gujarat"}')).toBe('Gujarat')
    expect(parseState('not json')).toBe('')
    expect(parseState('{}')).toBe('')
  })
})

describe('monthlyTrend', () => {
  it('sums created sales and purchases per month, ascending', () => {
    const sales = [
      sale({ invoice_date: '2026-06-01', total_invoice_amount: 100, total_qty_kg: 10 }),
      sale({ invoice_date: '2026-05-20', total_invoice_amount: 50, total_qty_kg: 5 }),
      sale({ status: 'reserved', invoice_date: null }),
    ]
    const purchases = [purchase({ invoice_date: '2026-06-03', total_invoice_amount: 70, qty_kg: 7 })]
    const t = monthlyTrend(sales, purchases)
    expect(t.map(p => p.key)).toEqual(['2026-05', '2026-06'])
    expect(t[1]).toMatchObject({ key: '2026-06', label: 'June 2026', salesAmt: 100, salesKg: 10, purchAmt: 70, purchKg: 7 })
  })
})

describe('receivables', () => {
  it('totals pending created sales and buckets them by age', () => {
    const sales = [
      sale({ id: 1, invoice_date: '2026-06-10', total_invoice_amount: 100 }),  // 3 days → 0-30
      sale({ id: 2, invoice_date: '2026-05-01', total_invoice_amount: 200 }),  // 43 days → 31-60
      sale({ id: 3, invoice_date: '2026-03-01', total_invoice_amount: 300 }),  // >60 → 60+
      sale({ id: 4, payment_status: 'done', invoice_date: '2026-06-01', total_invoice_amount: 999 }),
      sale({ id: 5, status: 'reserved', invoice_date: null, total_invoice_amount: 999 }),
    ]
    const r = receivables(sales, '2026-06-13')
    expect(r.total).toBe(600)
    expect(r.buckets).toEqual({ b0_30: 100, b31_60: 200, b60plus: 300 })
    expect(r.overdue.map(o => o.sale.id)).toEqual([3, 2, 1])  // oldest first
  })

  it('places aging-bucket boundary days in the correct bucket', () => {
    // today − invoice_date semantics, today = '2026-06-13':
    //   '2026-05-14' → 30 days (boundary into b0_30)
    //   '2026-04-14' → 60 days (boundary into b31_60)
    //   '2026-04-13' → 61 days (first day of b60plus)
    const sales = [
      sale({ id: 1, invoice_date: '2026-05-14', total_invoice_amount: 100 }),  // exactly 30 → b0_30
      sale({ id: 2, invoice_date: '2026-04-14', total_invoice_amount: 200 }),  // exactly 60 → b31_60
      sale({ id: 3, invoice_date: '2026-04-13', total_invoice_amount: 300 }),  // 61 → b60plus
    ]
    const r = receivables(sales, '2026-06-13')
    expect(r.overdue.find(o => o.sale.id === 1)!.daysOld).toBe(30)
    expect(r.overdue.find(o => o.sale.id === 2)!.daysOld).toBe(60)
    expect(r.overdue.find(o => o.sale.id === 3)!.daysOld).toBe(61)
    expect(r.buckets).toEqual({ b0_30: 100, b31_60: 200, b60plus: 300 })
  })
})

describe('payables', () => {
  it('flags purchases pending more than 2 days', () => {
    const purchases = [
      purchase({ id: 1, invoice_date: '2026-06-12', total_invoice_amount: 100 }),  // 1 day → not due
      purchase({ id: 2, invoice_date: '2026-06-11', total_invoice_amount: 200 }),  // 2 days → not due (strict >2)
      purchase({ id: 3, invoice_date: '2026-06-09', total_invoice_amount: 300 }),  // 4 days → due
      purchase({ id: 4, payment_status: 'done', invoice_date: '2026-01-01', total_invoice_amount: 999 }),
    ]
    const p = payables(purchases, '2026-06-13')
    expect(p.total).toBe(600)
    expect(p.due.map(d => d.id)).toEqual([3])
  })

  it('counts a purchase aged exactly 3 days as the first day that IS due', () => {
    // today − invoice_date = 3, strict >2 → due
    const purchases = [purchase({ id: 7, invoice_date: '2026-06-10', total_invoice_amount: 100 })]
    const p = payables(purchases, '2026-06-13')
    expect(p.due.map(d => d.id)).toEqual([7])
  })
})

describe('gstSnapshot', () => {
  it('nets output tax (created sales) against input tax (purchases)', () => {
    const sales = [sale({ cgst: 9, sgst: 9, igst: 0 }), sale({ status: 'reserved', cgst: 5, sgst: 5 })]
    const purchases = [purchase({ cgst: 4, sgst: 4, igst: 0 })]
    expect(gstSnapshot(sales, purchases)).toEqual({ output: 18, input: 8, net: 10 })
  })
})

describe('monthDelta', () => {
  it('compares current month to previous, null when no prior sales', () => {
    const sales = [
      sale({ invoice_date: '2026-06-05', total_invoice_amount: 150 }),
      sale({ invoice_date: '2026-05-05', total_invoice_amount: 100 }),
    ]
    expect(monthDelta(sales, '2026-06-20')).toEqual({ current: 150, previous: 100, pct: 50 })
    expect(monthDelta([sale({ invoice_date: '2026-06-05', total_invoice_amount: 150 })], '2026-06-20').pct).toBeNull()
  })

  it('wraps the previous month to the prior year at the January boundary', () => {
    const sales = [
      sale({ invoice_date: '2026-01-10', total_invoice_amount: 150 }),  // current → Jan 2026
      sale({ invoice_date: '2025-12-10', total_invoice_amount: 100 }),  // previous → Dec 2025
    ]
    expect(monthDelta(sales, '2026-01-15')).toEqual({ current: 150, previous: 100, pct: 50 })
  })
})
