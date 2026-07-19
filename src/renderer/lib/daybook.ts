// Pure logic behind the Day Book: everything that happened on one date. No React, no window.api.
import type { Sale, Purchase } from '@shared/types'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface DayLine { id: number; ref: string; party: string; amount: number }
export interface DaySection { lines: DayLine[]; total: number }
export interface DayBook {
  date: string
  salesInvoiced: DaySection
  purchasesBooked: DaySection
  paymentsReceived: DaySection
  paymentsMade: DaySection
  netIn: number            // money received today − money paid out today
}

function section(lines: DayLine[]): DaySection {
  return { lines, total: r2(lines.reduce((a, l) => a + l.amount, 0)) }
}
const saleLine = (s: Sale): DayLine => ({ id: s.id, ref: s.invoice_number, party: s.buyer_name, amount: s.total_invoice_amount })
const purchLine = (p: Purchase): DayLine => ({ id: p.id, ref: p.our_code, party: p.party, amount: p.total_invoice_amount })

/**
 * A single day's activity. `date` is YYYY-MM-DD.
 *
 * The two payment sections key off `payment_date`, which is a field the user fills on the sale /
 * purchase form (there is no "mark paid = today" action). An invoice marked paid but left without a
 * payment_date will not surface in any day's payment section — that is expected; it still counts on
 * the Reports and Outstanding screens.
 */
export function dayBook(date: string, data: { sales: Sale[]; purchases: Purchase[] }): DayBook {
  const salesInvoiced = section(
    data.sales.filter(s => s.status === 'created' && s.invoice_date === date).map(saleLine)
  )
  const purchasesBooked = section(
    data.purchases.filter(p => p.invoice_date === date).map(purchLine)
  )
  const paymentsReceived = section(
    data.sales.filter(s => s.status === 'created' && s.payment_status === 'done' && s.payment_date === date).map(saleLine)
  )
  const paymentsMade = section(
    data.purchases.filter(p => p.payment_status === 'done' && p.payment_date === date).map(purchLine)
  )
  return {
    date, salesInvoiced, purchasesBooked, paymentsReceived, paymentsMade,
    netIn: r2(paymentsReceived.total - paymentsMade.total),
  }
}

/** Step a YYYY-MM-DD date by whole days (UTC, avoids DST/timezone drift). */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d + days))
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}
