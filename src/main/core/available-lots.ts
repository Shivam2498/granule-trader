import type Database from 'better-sqlite3'
import type { AvailableLot } from '@shared/types'
import { round2 } from './money'

export function listAvailableLots(
  db: Database.Database, asOfDate: string, opts?: { excludeSaleId?: number }
): AvailableLot[] {
  const exclude = opts?.excludeSaleId ?? -1
  const rows = db.prepare(`
    SELECT p.id AS purchase_id, p.our_code, p.party, p.hsn_code, p.invoice_date, p.qty_kg,
      COALESCE((SELECT SUM(a.qty_drawn_kg) FROM sale_allocations a
                JOIN sales s ON s.id = a.sale_id
                WHERE a.purchase_id = p.id AND s.invoice_date IS NOT NULL
                  AND s.invoice_date <= @d AND s.id <> @ex), 0) AS sold,
      COALESCE((SELECT SUM(adj.qty_kg) FROM stock_adjustments adj
                WHERE adj.purchase_id = p.id AND adj.date <= @d), 0) AS adjusted
    FROM purchases p
    WHERE p.invoice_date <= @d
    ORDER BY p.invoice_date ASC, p.id ASC
  `).all({ d: asOfDate, ex: exclude }) as Array<AvailableLot & { qty_kg: number; sold: number; adjusted: number }>

  return rows
    .map(r => ({
      purchase_id: r.purchase_id, our_code: r.our_code, party: r.party,
      hsn_code: r.hsn_code, invoice_date: r.invoice_date,
      available_kg: round2(r.qty_kg - r.sold - r.adjusted)
    }))
    .filter(r => r.available_kg > 0)
}
