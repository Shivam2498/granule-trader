import type Database from 'better-sqlite3'
import type { Settings, HsnProduct } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  seller_name: '', seller_address: '', seller_gstin: '', seller_pan: '', seller_phone: '',
  seller_city: '', seller_pincode: '', home_state: '',
  seller_godown_address: '', seller_udyam: '', seller_email: '',
  bank_name: '', bank_branch: '', bank_account_no: '', bank_ifsc: '',
  invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10
}

export function getSettings(db: Database.Database): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map(r => [r.key, r.value]))
  const result = { ...DEFAULT_SETTINGS } as any
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!map.has(key)) continue
    const raw = map.get(key)!
    result[key] = typeof DEFAULT_SETTINGS[key] === 'number' ? Number(raw) : raw
  }
  return result
}

export function saveSettings(db: Database.Database, partial: Partial<Settings>): Settings {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const tx = db.transaction(() => { for (const [k, v] of Object.entries(partial)) up.run(k, String(v)) })
  tx()
  return getSettings(db)
}

export function listHsn(db: Database.Database): HsnProduct[] {
  return db.prepare('SELECT * FROM hsn_products ORDER BY hsn_code').all() as HsnProduct[]
}

export function upsertHsn(db: Database.Database, h: HsnProduct): void {
  db.prepare(`INSERT INTO hsn_products (hsn_code, description, gst_rate) VALUES (?, ?, ?)
    ON CONFLICT(hsn_code) DO UPDATE SET description = excluded.description, gst_rate = excluded.gst_rate`)
    .run(h.hsn_code, h.description, h.gst_rate)
}

// An HSN code is referenced by name (not by foreign key) from purchases and from the
// gst_rate snapshot on sale_allocations. Deleting one that is still in use would leave
// old invoices printing a blank description, so refuse and name who is using it.
export function deleteHsn(db: Database.Database, code: string): void {
  const purchases = (db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE hsn_code = ?').get(code) as { n: number }).n
  const invoices = (db.prepare('SELECT COUNT(DISTINCT sale_id) AS n FROM sale_allocations WHERE hsn_code = ?').get(code) as { n: number }).n
  if (purchases > 0 || invoices > 0) {
    const used = [
      purchases > 0 ? `${purchases} purchase${purchases === 1 ? '' : 's'}` : null,
      invoices > 0 ? `${invoices} invoice${invoices === 1 ? '' : 's'}` : null
    ].filter(Boolean).join(' and ')
    throw new Error(`Product ${code} is used by ${used}, so it can't be deleted. You can still change its description or GST %.`)
  }
  db.prepare('DELETE FROM hsn_products WHERE hsn_code = ?').run(code)
}

export function getHsnRate(db: Database.Database, code: string, fallback: number): number {
  const r = db.prepare('SELECT gst_rate FROM hsn_products WHERE hsn_code = ?').get(code) as { gst_rate: number } | undefined
  return r ? r.gst_rate : fallback
}
