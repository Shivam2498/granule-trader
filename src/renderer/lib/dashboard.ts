import type { Sale, Purchase } from '@shared/types'
import { monthLabel } from './group'

export interface MonthPoint { key: string; label: string; salesAmt: number; salesKg: number; purchAmt: number; purchKg: number }
export interface AgingBuckets { b0_30: number; b31_60: number; b60plus: number }

// Whole days from a YYYY-MM-DD date to today (today − date); negative if date is in the future.
export function daysBetween(date: string, today: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.floor((p(today) - p(date)) / 86400000)
}

export function parseState(billingJson: string): string {
  try { const o = JSON.parse(billingJson); return typeof o?.state === 'string' ? o.state : '' } catch { return '' }
}

export function monthlyTrend(sales: Sale[], purchases: Purchase[]): MonthPoint[] {
  const acc = new Map<string, MonthPoint>()
  const at = (k: string): MonthPoint => {
    const e = acc.get(k) ?? { key: k, label: monthLabel(k), salesAmt: 0, salesKg: 0, purchAmt: 0, purchKg: 0 }
    acc.set(k, e); return e
  }
  for (const s of sales) {
    if (s.status !== 'created' || !s.invoice_date) continue
    const e = at(s.invoice_date.slice(0, 7)); e.salesAmt += s.total_invoice_amount; e.salesKg += s.total_qty_kg
  }
  for (const p of purchases) {
    const e = at(p.invoice_date.slice(0, 7)); e.purchAmt += p.total_invoice_amount; e.purchKg += p.qty_kg
  }
  return [...acc.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function bucketize(items: Array<{ amt: number; days: number }>): AgingBuckets {
  const b: AgingBuckets = { b0_30: 0, b31_60: 0, b60plus: 0 }
  for (const it of items) {
    if (it.days <= 30) b.b0_30 += it.amt
    else if (it.days <= 60) b.b31_60 += it.amt
    else b.b60plus += it.amt
  }
  return b
}

export function receivables(sales: Sale[], today: string) {
  const pend = sales.filter(s => s.status === 'created' && s.payment_status === 'pending' && s.invoice_date)
  const total = pend.reduce((a, s) => a + s.total_invoice_amount, 0)
  const buckets = bucketize(pend.map(s => ({ amt: s.total_invoice_amount, days: daysBetween(s.invoice_date!, today) })))
  const overdue = pend
    .map(s => ({ sale: s, daysOld: daysBetween(s.invoice_date!, today) }))
    .sort((a, b) => b.daysOld - a.daysOld)
  return { total, buckets, overdue }
}

export function payables(purchases: Purchase[], today: string) {
  const pend = purchases.filter(p => p.payment_status === 'pending')
  const total = pend.reduce((a, p) => a + p.total_invoice_amount, 0)
  const buckets = bucketize(pend.map(p => ({ amt: p.total_invoice_amount, days: daysBetween(p.invoice_date, today) })))
  const due = pend
    .filter(p => daysBetween(p.invoice_date, today) > 2)
    .sort((a, b) => daysBetween(b.invoice_date, today) - daysBetween(a.invoice_date, today))
  return { total, buckets, due }
}

export function gstSnapshot(sales: Sale[], purchases: Purchase[]) {
  const created = sales.filter(s => s.status === 'created')
  const output = created.reduce((a, s) => a + s.cgst + s.sgst + s.igst, 0)
  const input = purchases.reduce((a, p) => a + p.cgst + p.sgst + p.igst, 0)
  return { output, input, net: output - input }
}

export function monthDelta(sales: Sale[], today: string) {
  const created = sales.filter(s => s.status === 'created' && s.invoice_date)
  const cur = today.slice(0, 7)
  const [y, m] = cur.split('-').map(Number)
  const pd = new Date(Date.UTC(y, m - 2, 1))
  const prev = `${pd.getUTCFullYear()}-${String(pd.getUTCMonth() + 1).padStart(2, '0')}`
  const sum = (mk: string) => created.filter(s => s.invoice_date!.slice(0, 7) === mk).reduce((a, s) => a + s.total_invoice_amount, 0)
  const current = sum(cur), previous = sum(prev)
  return { current, previous, pct: previous === 0 ? null : ((current - previous) / previous) * 100 }
}
