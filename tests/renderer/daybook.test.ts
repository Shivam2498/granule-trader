import { describe, it, expect } from 'vitest'
import { dayBook, shiftDate } from '../../src/renderer/lib/daybook'
import type { Sale, Purchase } from '../../src/shared/types'

const sale = (o: Partial<Sale>): Sale => ({
  id: 1, invoice_number: 'RP/001', status: 'created', invoice_date: '2026-07-19',
  buyer_name: 'Jenisa', total_invoice_amount: 100, payment_status: 'pending', payment_date: null, ...o
} as Sale)
const purchase = (o: Partial<Purchase>): Purchase => ({
  id: 1, our_code: '001/2627', invoice_date: '2026-07-19', party: 'Swastik',
  total_invoice_amount: 200, payment_status: 'pending', payment_date: null, ...o
} as Purchase)

describe('dayBook', () => {
  const sales = [
    sale({ id: 1, invoice_number: 'RP/001', invoice_date: '2026-07-19', total_invoice_amount: 5900 }),
    sale({ id: 2, invoice_number: 'RP/002', invoice_date: '2026-07-18', total_invoice_amount: 999 }),           // other day
    sale({ id: 3, invoice_number: 'RP/003', status: 'reserved', invoice_date: '2026-07-19' }),                  // draft: excluded
    sale({ id: 4, invoice_number: 'RP/004', invoice_date: '2026-07-01', payment_status: 'done', payment_date: '2026-07-19', total_invoice_amount: 12000 }), // paid today, invoiced earlier
  ]
  const purchases = [
    purchase({ id: 10, our_code: '040/2627', invoice_date: '2026-07-19', total_invoice_amount: 14160 }),
    purchase({ id: 11, our_code: '039/2627', invoice_date: '2026-06-01', payment_status: 'done', payment_date: '2026-07-19', total_invoice_amount: 3000 }), // paid today
  ]

  it('buckets each of the four sections for the chosen day', () => {
    const db = dayBook('2026-07-19', { sales, purchases })
    expect(db.salesInvoiced.lines.map(l => l.id)).toEqual([1])           // RP/002 other day, RP/003 draft
    expect(db.salesInvoiced.total).toBe(5900)
    expect(db.purchasesBooked.lines.map(l => l.id)).toEqual([10])
    expect(db.purchasesBooked.total).toBe(14160)
    expect(db.paymentsReceived.lines.map(l => l.id)).toEqual([4])
    expect(db.paymentsReceived.total).toBe(12000)
    expect(db.paymentsMade.lines.map(l => l.id)).toEqual([11])
    expect(db.paymentsMade.total).toBe(3000)
    expect(db.netIn).toBe(9000)                                          // 12000 received − 3000 paid
  })

  it('is all-empty on a quiet day', () => {
    const db = dayBook('2026-01-01', { sales, purchases })
    expect(db.salesInvoiced.total + db.purchasesBooked.total + db.paymentsReceived.total + db.paymentsMade.total).toBe(0)
    expect(db.netIn).toBe(0)
  })
})

describe('shiftDate', () => {
  it('steps whole days and crosses month boundaries', () => {
    expect(shiftDate('2026-07-19', -1)).toBe('2026-07-18')
    expect(shiftDate('2026-07-19', 1)).toBe('2026-07-20')
    expect(shiftDate('2026-07-31', 1)).toBe('2026-08-01')
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28')
  })
})
