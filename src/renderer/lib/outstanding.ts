// Pure logic behind the Outstanding screen: unpaid sales grouped by customer (money owed TO you)
// and unpaid purchases grouped by supplier (money YOU owe), each aged. No React, no window.api.
import type { Sale, Purchase } from '@shared/types'
import { daysBetween } from './dashboard'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

export interface PartyDue {
  id: number
  name: string
  count: number          // number of unpaid invoices
  b0_30: number
  b31_60: number
  b60plus: number
  total: number
  oldestDays: number     // age of the oldest unpaid invoice, for sorting/urgency
}
export interface OutstandingReport { rows: PartyDue[]; total: number }

function group(items: Array<{ id: number; name: string; amt: number; days: number }>): OutstandingReport {
  const by = new Map<number, PartyDue>()
  for (const it of items) {
    const e = by.get(it.id) ?? { id: it.id, name: it.name, count: 0, b0_30: 0, b31_60: 0, b60plus: 0, total: 0, oldestDays: 0 }
    e.count += 1
    e.total = r2(e.total + it.amt)
    if (it.days <= 30) e.b0_30 = r2(e.b0_30 + it.amt)
    else if (it.days <= 60) e.b31_60 = r2(e.b31_60 + it.amt)
    else e.b60plus = r2(e.b60plus + it.amt)
    e.oldestDays = Math.max(e.oldestDays, it.days)
    by.set(it.id, e)
  }
  const rows = [...by.values()].sort((a, b) => b.total - a.total || b.oldestDays - a.oldestDays)
  return { rows, total: r2(rows.reduce((a, r) => a + r.total, 0)) }
}

/** Money customers owe you — unpaid, issued sales grouped by buyer. */
export function receivablesByParty(sales: Sale[], today: string): OutstandingReport {
  return group(
    sales
      .filter(s => s.status === 'created' && s.payment_status === 'pending' && s.invoice_date && s.buyer_customer_id != null)
      .map(s => ({ id: s.buyer_customer_id!, name: s.buyer_name, amt: s.total_invoice_amount, days: daysBetween(s.invoice_date!, today) }))
  )
}

/** Money you owe suppliers — unpaid purchases grouped by supplier. */
export function payablesByParty(purchases: Purchase[], today: string): OutstandingReport {
  return group(
    purchases
      .filter(p => p.payment_status === 'pending' && p.supplier_id != null)
      .map(p => ({ id: p.supplier_id!, name: p.party, amt: p.total_invoice_amount, days: daysBetween(p.invoice_date, today) }))
  )
}
