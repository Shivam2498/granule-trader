import type Database from 'better-sqlite3'
import { formatInvoiceNumber } from './invoice-number'

export function reserveGaps(db: Database.Database, prefix: string, fyLabel: string, fromSeqExclusive: number, toSeqExclusive: number): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
    VALUES (?, ?, ?, ?, 'reserved', NULL)`)
  const tx = db.transaction(() => {
    for (let s = fromSeqExclusive + 1; s < toSeqExclusive; s++)
      insert.run(formatInvoiceNumber(prefix, s, fyLabel), prefix, s, fyLabel)
  })
  tx()
}

export function validateInvoiceOrder(
  db: Database.Database,
  opts: { fyLabel: string; seq: number; invoiceDate: string; excludeSaleId?: number }
): { ok: boolean; message?: string } {
  const exclude = opts.excludeSaleId ?? -1
  const prev = db.prepare(`SELECT invoice_date FROM sales
    WHERE fy_label = ? AND status = 'created' AND seq < ? AND invoice_date IS NOT NULL AND id <> ?
    ORDER BY seq DESC LIMIT 1`).get(opts.fyLabel, opts.seq, exclude) as { invoice_date: string } | undefined
  const next = db.prepare(`SELECT invoice_date FROM sales
    WHERE fy_label = ? AND status = 'created' AND seq > ? AND invoice_date IS NOT NULL AND id <> ?
    ORDER BY seq ASC LIMIT 1`).get(opts.fyLabel, opts.seq, exclude) as { invoice_date: string } | undefined

  if (prev && opts.invoiceDate < prev.invoice_date)
    return { ok: false, message: `Date must be on or after ${prev.invoice_date} to keep invoice order valid` }
  if (next && opts.invoiceDate > next.invoice_date)
    return { ok: false, message: `Date must be on or before ${next.invoice_date} to keep invoice order valid` }
  return { ok: true }
}
