import type Database from 'better-sqlite3'
import { financialYear } from './financial-year'

export function formatInvoiceNumber(prefix: string, seq: number, fyLabel: string): string {
  return `${prefix}/${String(seq).padStart(3, '0')}/${fyLabel}`
}

export function parseInvoiceNumber(s: string): { prefix: string; seq: number; fyLabel: string } | null {
  const m = s.trim().match(/^(.+?)\/(\d+)\/(\d{4}-\d{2})$/)
  if (!m) return null
  return { prefix: m[1], seq: Number(m[2]), fyLabel: m[3] }
}

// NOTE: numbering is scoped per financial year, not per prefix. The invoice/code prefix is treated as
// fixed within a financial year; changing it mid-FY is unsupported (would share the seq sequence).
export function nextInvoiceNumber(db: Database.Database, date: string, prefix: string): string {
  const fy = financialYear(date)
  const row = db.prepare('SELECT MAX(seq) AS m FROM sales WHERE fy_label = ?').get(fy.label) as { m: number | null }
  return formatInvoiceNumber(prefix, (row.m ?? 0) + 1, fy.label)
}
