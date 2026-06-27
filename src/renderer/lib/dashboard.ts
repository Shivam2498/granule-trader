import type { Sale, Purchase, LedgerRow } from '@shared/types'
import { monthLabel } from './group'

export interface MonthPoint { key: string; label: string; salesAmt: number; salesKg: number; purchAmt: number; purchKg: number }
export interface AgingBuckets { b0_30: number; b31_60: number; b60plus: number }
export interface StockSlice { hsn: string; kg: number; value: number }
export interface AgeBucket { bucket: '0-30' | '31-60' | '61-90' | '90+'; kg: number; value: number }

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

function purchaseMap(purchases: Purchase[]): Map<number, Purchase> {
  return new Map(purchases.map(p => [p.id, p]))
}

export function stockByProduct(ledger: LedgerRow[], purchases: Purchase[]): StockSlice[] {
  const pm = purchaseMap(purchases)
  const by = new Map<string, StockSlice>()
  for (const r of ledger) {
    if (r.balance_kg <= 0) continue
    const rate = pm.get(r.purchase_id)?.rate_per_kg ?? 0
    const e = by.get(r.hsn_code) ?? { hsn: r.hsn_code, kg: 0, value: 0 }
    e.kg += r.balance_kg; e.value += r.balance_kg * rate; by.set(r.hsn_code, e)
  }
  return [...by.values()].sort((a, b) => b.value - a.value)
}

export function inventoryAging(ledger: LedgerRow[], purchases: Purchase[], today: string): AgeBucket[] {
  const pm = purchaseMap(purchases)
  const b: Record<AgeBucket['bucket'], AgeBucket> = {
    '0-30': { bucket: '0-30', kg: 0, value: 0 },
    '31-60': { bucket: '31-60', kg: 0, value: 0 },
    '61-90': { bucket: '61-90', kg: 0, value: 0 },
    '90+': { bucket: '90+', kg: 0, value: 0 },
  }
  for (const r of ledger) {
    if (r.balance_kg <= 0) continue
    const days = daysBetween(r.invoice_date, today)
    const rate = pm.get(r.purchase_id)?.rate_per_kg ?? 0
    const k: AgeBucket['bucket'] = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
    b[k].kg += r.balance_kg; b[k].value += r.balance_kg * rate
  }
  return [b['0-30'], b['31-60'], b['61-90'], b['90+']]
}

export function lowStock(ledger: LedgerRow[], threshold: number): LedgerRow[] {
  return ledger.filter(r => r.balance_kg > 0 && r.balance_kg < threshold)
}

export function reservedPendingFill(sales: Sale[]): Sale[] {
  return sales.filter(s => s.status === 'reserved')
}
