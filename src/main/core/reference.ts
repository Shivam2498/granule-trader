import type Database from 'better-sqlite3'
import type { Settings, HsnProduct } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  seller_name: '', seller_address: '', seller_gstin: '', seller_pan: '', seller_phone: '', home_state: '',
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

export function getHsnRate(db: Database.Database, code: string, fallback: number): number {
  const r = db.prepare('SELECT gst_rate FROM hsn_products WHERE hsn_code = ?').get(code) as { gst_rate: number } | undefined
  return r ? r.gst_rate : fallback
}
