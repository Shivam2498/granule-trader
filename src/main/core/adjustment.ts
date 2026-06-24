import type Database from 'better-sqlite3'
import type { LedgerRow } from '@shared/types'
import { round2 } from './money'

export function createStockAdjustment(
  db: Database.Database,
  input: { purchase_id: number; qty_kg: number; reason: string; date: string }
): void {
  const tx = db.transaction(() => {
    const lot = db.prepare('SELECT qty_remaining_kg FROM purchases WHERE id = ?').get(input.purchase_id) as { qty_remaining_kg: number } | undefined
    if (!lot) throw new Error('Lot not found')
    if (round2(input.qty_kg) > lot.qty_remaining_kg)
      throw new Error(`This lot only has ${lot.qty_remaining_kg} kg left`)
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
