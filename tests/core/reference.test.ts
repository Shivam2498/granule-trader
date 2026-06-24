import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { getSettings, saveSettings, upsertHsn, getHsnRate } from '../../src/main/core/reference'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

describe('settings', () => {
  it('returns defaults then persists overrides', () => {
    expect(getSettings(db).default_gst_rate).toBe(18)
    saveSettings(db, { home_state: 'Gujarat', invoice_prefix: 'RP' })
    expect(getSettings(db).home_state).toBe('Gujarat')
    expect(getSettings(db).invoice_prefix).toBe('RP')
  })
})

describe('hsn', () => {
  it('upserts and reads a rate with fallback', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    expect(getHsnRate(db, '3902', 18)).toBe(5)
    expect(getHsnRate(db, '9999', 18)).toBe(18)
  })
})
