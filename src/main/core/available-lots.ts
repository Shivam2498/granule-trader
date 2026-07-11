import type Database from 'better-sqlite3'
import type { AvailableLot } from '@shared/types'
import { round2 } from './money'

/** '0007/2526' for a single-line purchase, '0007/2526-2' for line 2 of a multi-line one. */
export function lotCode(ourCode: string, lineNo: number, lineCount: number): string {
  return lineCount > 1 ? `${ourCode}-${lineNo}` : ourCode
}

export function listAvailableLots(
  db: Database.Database, asOfDate: string, opts?: { excludeSaleId?: number }
): AvailableLot[] {
  const exclude = opts?.excludeSaleId ?? -1
  const rows = db.prepare(`
    SELECT i.id AS purchase_item_id, p.id AS purchase_id, p.our_code, p.party, i.hsn_code, i.description,
      p.invoice_date, i.rate_per_kg, i.qty_kg, i.line_no,
      (SELECT COUNT(*) FROM purchase_items x WHERE x.purchase_id = p.id) AS line_count,
      COALESCE((SELECT SUM(a.qty_drawn_kg) FROM sale_allocations a
                JOIN sales s ON s.id = a.sale_id
                WHERE a.purchase_item_id = i.id AND s.invoice_date IS NOT NULL
                  AND s.invoice_date <= @d AND s.id <> @ex), 0) AS sold,
      COALESCE((SELECT SUM(adj.qty_kg) FROM stock_adjustments adj
                WHERE adj.purchase_item_id = i.id AND adj.date <= @d), 0) AS adjusted
    FROM purchase_items i
    JOIN purchases p ON p.id = i.purchase_id
    WHERE p.invoice_date <= @d
    ORDER BY p.invoice_date ASC, p.id ASC, i.line_no ASC
  `).all({ d: asOfDate, ex: exclude }) as Array<{
    purchase_item_id: number; purchase_id: number; our_code: string; party: string; hsn_code: string
    description: string; invoice_date: string; rate_per_kg: number; qty_kg: number; line_no: number
    line_count: number; sold: number; adjusted: number
  }>

  return rows
    .map(r => ({
      purchase_item_id: r.purchase_item_id, purchase_id: r.purchase_id,
      our_code: lotCode(r.our_code, r.line_no, r.line_count),
      party: r.party, hsn_code: r.hsn_code, description: r.description,
      invoice_date: r.invoice_date, rate_per_kg: r.rate_per_kg,
      available_kg: round2(r.qty_kg - r.sold - r.adjusted)
    }))
    .filter(r => r.available_kg > 0)
}
