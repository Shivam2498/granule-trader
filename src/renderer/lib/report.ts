// Pure logic behind the Reports screen. No React, no window.api — unit-tested.
import type { Sale, Purchase } from '@shared/types'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-27' → the FY's twelve months, April first, as select options keyed 'YYYY-MM'. */
export function fyMonths(fyLabel: string): Array<{ value: string; label: string }> {
  const startYear = Number(fyLabel.slice(0, 4))
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1                    // Apr=4 … Dec=12, Jan=1 … Mar=3
    const y = m >= 4 ? startYear : startYear + 1
    return { value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTHS[m - 1]} ${y}` }
  })
}

export function filterSalesReport(sales: Sale[], customerId: number, month?: string): Sale[] {
  return sales
    .filter(s => s.status === 'created' && s.buyer_customer_id === customerId)
    .filter(s => !month || (s.invoice_date ?? '').startsWith(month))
    .sort((a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? '') || a.seq - b.seq)
}

export function filterPurchasesReport(purchases: Purchase[], supplierId: number, month?: string): Purchase[] {
  return purchases
    .filter(p => p.supplier_id === supplierId)
    .filter(p => !month || p.invoice_date.startsWith(month))
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.code_seq - b.code_seq)
}

export interface TotalRow { qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }
export const saleTotalRow = (s: Sale): TotalRow =>
  ({ qty: s.total_qty_kg, taxable: s.amount, cgst: s.cgst, sgst: s.sgst, igst: s.igst, total: s.total_invoice_amount })
export const purchaseTotalRow = (p: Purchase): TotalRow =>
  ({ qty: p.qty_kg, taxable: p.amount, cgst: p.cgst, sgst: p.sgst, igst: p.igst, total: p.total_invoice_amount })

export function reportTotals(rows: TotalRow[]): TotalRow {
  const t = { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }
  for (const r of rows) {
    t.qty = r2(t.qty + r.qty); t.taxable = r2(t.taxable + r.taxable)
    t.cgst = r2(t.cgst + r.cgst); t.sgst = r2(t.sgst + r.sgst)
    t.igst = r2(t.igst + r.igst); t.total = r2(t.total + r.total)
  }
  return t
}

export function reportFilename(kind: 'Sales' | 'Purchases', party: string, fyLabel: string, monthLabel?: string): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${kind}-${slug(party)}-${slug(monthLabel ?? fyLabel)}.csv`
}
