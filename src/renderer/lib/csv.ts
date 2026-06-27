import type { Sale, Purchase } from '@shared/types'
import { parseState } from './dashboard'

export interface CsvColumn<T> { header: string; value: (row: T) => string | number }

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const esc = (v: string | number): string => {
    const s = String(v)
    // formula-injection guard: neutralise leading = + - @ (or tab/CR) so spreadsheets don't execute
    if (/^[=+\-@\t\r]/.test(s)) return '"\''+s.replace(/"/g,'""')+'"'
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const head = columns.map(c => esc(c.header)).join(',')
  const body = rows.map(r => columns.map(c => esc(c.value(r))).join(',')).join('\n')
  return body ? head + '\n' + body : head
}

export const salesColumns: CsvColumn<Sale>[] = [
  { header: 'Invoice No', value: s => s.invoice_number },
  { header: 'Date', value: s => s.invoice_date ?? '' },
  { header: 'Buyer', value: s => s.buyer_name },
  { header: 'Buyer GSTIN', value: s => s.buyer_gstin },
  { header: 'State', value: s => parseState(s.buyer_billing_json) },
  { header: 'Qty (kg)', value: s => s.total_qty_kg },
  { header: 'Taxable', value: s => s.amount },
  { header: 'CGST', value: s => s.cgst },
  { header: 'SGST', value: s => s.sgst },
  { header: 'IGST', value: s => s.igst },
  { header: 'TCS', value: s => s.tcs },
  { header: 'Round-off', value: s => s.roundoff },
  { header: 'Total', value: s => s.total_invoice_amount },
  { header: 'Payment status', value: s => s.payment_status },
  { header: 'Payment date', value: s => s.payment_date ?? '' },
]

export const purchaseColumns: CsvColumn<Purchase>[] = [
  { header: 'Code', value: p => p.our_code },
  { header: 'Supplier Inv No', value: p => p.supplier_invoice_number },
  { header: 'Date', value: p => p.invoice_date ?? '' },
  { header: 'Supplier', value: p => p.party },
  { header: 'State', value: p => p.party_state },
  { header: 'HSN', value: p => p.hsn_code },
  { header: 'Qty (kg)', value: p => p.qty_kg },
  { header: 'Rate', value: p => p.rate_per_kg },
  { header: 'Taxable', value: p => p.amount },
  { header: 'CGST', value: p => p.cgst },
  { header: 'SGST', value: p => p.sgst },
  { header: 'IGST', value: p => p.igst },
  { header: 'TCS', value: p => p.tcs },
  { header: 'Round-off', value: p => p.roundoff },
  { header: 'Total', value: p => p.total_invoice_amount },
  { header: 'Payment status', value: p => p.payment_status },
  { header: 'Payment date', value: p => p.payment_date ?? '' },
]
