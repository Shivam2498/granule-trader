import type Database from 'better-sqlite3'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { createCustomer, placeOfSupplyState } from './customers'
import type { NewSale, NewSaleLine } from './sale'

// Excel's 1900 date system: serial 25569 is 1970-01-01, and that offset already absorbs Excel's
// fictitious 1900-02-29, so plain (serial - 25569) days is correct for every date we handle.
export function excelSerialToISO(serial: number | string): string {
  const n = typeof serial === 'string' ? Number(serial) : serial
  const ms = (n - 25569) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}

export interface SaleHeader {
  invoice_number: string; invoice_date: string
  buyer_name: string; buyer_gstin: string
  eway_bill_no: string; eway_bill_date: string; vehicle: string
  roundoff: number; sheet_total: number
}

const INVOICE_RE = /^RP\/\d+\/\d{4}-\d{2}$/

export function parseSaleHeaders(rows: string[][]): Map<string, SaleHeader> {
  const out = new Map<string, SaleHeader>()
  for (const r of rows) {
    const inv = (r[0] ?? '').trim()
    if (!INVOICE_RE.test(inv)) continue
    out.set(inv, {
      invoice_number: inv,
      invoice_date: excelSerialToISO(r[1]),
      buyer_name: (r[5] ?? '').trim(),
      buyer_gstin: (r[6] ?? '').trim(),
      eway_bill_no: (r[2] ?? '').trim(),
      eway_bill_date: (r[3] ?? '').trim() ? excelSerialToISO(r[3]) : '',
      vehicle: (r[4] ?? '').trim(),
      roundoff: (r[34] ?? '').trim() ? Number(r[34]) : 0,
      sheet_total: (r[35] ?? '').trim() ? Number(r[35]) : 0
    })
  }
  return out
}
