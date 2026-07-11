import type Database from 'better-sqlite3'
import type { LedgerRow } from '@shared/types'
import { round2 } from './money'
import { lotCode } from './available-lots'

export interface AdjustmentRow {
  id: number; purchase_item_id: number; purchase_id: number; our_code: string
  hsn_code: string; qty_kg: number; reason: string; date: string
}

export function createStockAdjustment(
  db: Database.Database,
  input: { purchase_item_id: number; qty_kg: number; reason: string; date: string }
): void {
  const tx = db.transaction(() => {
    const lot = db.prepare('SELECT purchase_id, qty_remaining_kg FROM purchase_items WHERE id = ?')
      .get(input.purchase_item_id) as { purchase_id: number; qty_remaining_kg: number } | undefined
    if (!lot) throw new Error(`We couldn't find that stock lot.`)
    if (round2(input.qty_kg) <= 0) throw new Error('Adjustment quantity must be greater than zero.')
    if (round2(input.qty_kg) > lot.qty_remaining_kg)
      throw new Error(`This lot only has ${lot.qty_remaining_kg} kg available.`)
    db.prepare('INSERT INTO stock_adjustments (purchase_id, purchase_item_id, qty_kg, reason, date) VALUES (?, ?, ?, ?, ?)')
      .run(lot.purchase_id, input.purchase_item_id, round2(input.qty_kg), input.reason, input.date)
    db.prepare('UPDATE purchase_items SET qty_remaining_kg = round(qty_remaining_kg - ?, 2) WHERE id = ?')
      .run(round2(input.qty_kg), input.purchase_item_id)
  })
  tx()
}

export function stockLedger(db: Database.Database): LedgerRow[] {
  const rows = db.prepare(`
    SELECT i.id AS purchase_item_id, p.id AS purchase_id, p.our_code, i.hsn_code, p.party, p.invoice_date,
      i.rate_per_kg, i.qty_kg, i.line_no,
      (SELECT COUNT(*) FROM purchase_items x WHERE x.purchase_id = p.id) AS line_count,
      round(i.qty_kg - i.qty_remaining_kg, 2) AS consumed_kg, i.qty_remaining_kg AS balance_kg
    FROM purchase_items i
    JOIN purchases p ON p.id = i.purchase_id
    WHERE i.qty_remaining_kg > 0
    ORDER BY i.hsn_code ASC, p.invoice_date ASC, p.id ASC, i.line_no ASC
  `).all() as Array<LedgerRow & { line_no: number; line_count: number }>
  return rows.map(r => ({ ...r, our_code: lotCode(r.our_code, r.line_no, r.line_count) }))
}

export function listAdjustments(db: Database.Database, limit = 50): AdjustmentRow[] {
  return db.prepare(`
    SELECT a.id, a.purchase_item_id, a.purchase_id, p.our_code, i.hsn_code, a.qty_kg, a.reason, a.date
    FROM stock_adjustments a
    JOIN purchases p ON p.id = a.purchase_id
    LEFT JOIN purchase_items i ON i.id = a.purchase_item_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit) as AdjustmentRow[]
}

export function deleteAdjustment(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    const adj = db.prepare('SELECT purchase_item_id, qty_kg FROM stock_adjustments WHERE id = ?').get(id) as
      { purchase_item_id: number; qty_kg: number } | undefined
    if (!adj) return
    db.prepare('UPDATE purchase_items SET qty_remaining_kg = round(qty_remaining_kg + ?, 2) WHERE id = ?')
      .run(round2(adj.qty_kg), adj.purchase_item_id)
    db.prepare('DELETE FROM stock_adjustments WHERE id = ?').run(id)
  })
  tx()
}
