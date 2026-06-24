import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'

describe('schema', () => {
  it('creates all core tables', () => {
    const db = openDatabase(':memory:')
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name)
    for (const t of ['customers','hsn_products','purchases','sale_allocations','sales','settings','stock_adjustments'])
      expect(names).toContain(t)
    db.close()
  })

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })
})
