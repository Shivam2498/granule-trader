import type Database from 'better-sqlite3'
import type { LedgerRow } from '@shared/types'
import { round2 } from './money'

export interface AdjustmentRow {
  id: number; purchase_id: number; our_code: string; qty_kg: number; reason: string; date: string
}

export function createStockAdjustment(
  db: Database.Database,
  input: { purchase_id: number; qty_kg: number; reason: string; date: string }
): void {
  const tx = db.transaction(() => {
    const lot = db.prepare('SELECT qty_remaining_kg FROM purchases WHERE id = ?').get(input.purchase_id) as { qty_remaining_kg: number } | undefined
    if (!lot) throw new Error(`We couldn't find that stock lot.`)
    if (round2(input.qty_kg) <= 0) throw new Error('Adjustment quantity must be greater than zero.')
    if (round2(input.qty_kg) > lot.qty_remaining_kg)
      throw new Error(`This lot only has ${lot.qty_remaining_kg} kg available.`)
    db.prepare('INSERT INTO stock_adjustments (purchase_id, qty_kg, reason, date) VALUES (?, ?, ?, ?)')
      .run(input.purchase_id, round2(input.qty_kg), input.reason, input.date)
    db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg - ?, 2) WHERE id = ?')
      .run(round2(input.qty_kg), input.purchase_id)
  })
  tx()
}

export function stockLedger(db: Database.Database): LedgerRow[] {
  return db.prepare(`
    SELECT id AS purchase_id, our_code, hsn_code, party, invoice_date,
      qty_kg, round(qty_kg - qty_remaining_kg, 2) AS consumed_kg, qty_remaining_kg AS balance_kg
    FROM purchases WHERE qty_remaining_kg > 0
    ORDER BY hsn_code ASC, invoice_date ASC, id ASC
  `).all() as LedgerRow[]
}

export function listAdjustments(db: Database.Database, limit = 50): AdjustmentRow[] {
  return db.prepare(`
    SELECT a.id, a.purchase_id, p.our_code, a.qty_kg, a.reason, a.date
    FROM stock_adjustments a JOIN purchases p ON p.id = a.purchase_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit) as AdjustmentRow[]
}

export function deleteAdjustment(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    const adj = db.prepare('SELECT purchase_id, qty_kg FROM stock_adjustments WHERE id = ?').get(id) as { purchase_id: number; qty_kg: number } | undefined
    if (!adj) return
    db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg + ?, 2) WHERE id = ?').run(round2(adj.qty_kg), adj.purchase_id)
    db.prepare('DELETE FROM stock_adjustments WHERE id = ?').run(id)
  })
  tx()
}
