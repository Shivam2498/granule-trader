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

  it('defaults the new invoice fields to empty and persists them', () => {
    const s = getSettings(db)
    for (const k of ['seller_godown_address','seller_udyam','seller_email','bank_name','bank_branch','bank_account_no','bank_ifsc'] as const)
      expect(s[k]).toBe('')
    saveSettings(db, { bank_ifsc: 'ICIC0000317', seller_udyam: 'UDYAM-WB-10-0066963' })
    expect(getSettings(db).bank_ifsc).toBe('ICIC0000317')
    expect(getSettings(db).seller_udyam).toBe('UDYAM-WB-10-0066963')
  })
})

describe('hsn', () => {
  it('upserts and reads a rate with fallback', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    expect(getHsnRate(db, '3902', 18)).toBe(5)
    expect(getHsnRate(db, '9999', 18)).toBe(18)
  })
})
