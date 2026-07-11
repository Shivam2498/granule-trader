import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { getSettings, saveSettings, listHsn, upsertHsn, deleteHsn, getHsnRate } from '../../src/main/core/reference'

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

  it('upserting an existing code updates its description and rate', () => {
    upsertHsn(db, { hsn_code: '3902', description: '', gst_rate: 18 })
    upsertHsn(db, { hsn_code: '3902', description: 'PP Granules', gst_rate: 5 })
    expect(listHsn(db)).toEqual([{ hsn_code: '3902', description: 'PP Granules', gst_rate: 5 }])
  })
})

describe('deleteHsn', () => {
  it('removes an unused product', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    deleteHsn(db, '3902')
    expect(listHsn(db)).toEqual([])
  })

  it('refuses to delete a product a purchase still uses', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    db.prepare(`INSERT INTO purchases (our_code, invoice_date, hsn_code, qty_kg, qty_remaining_kg, fy_label, code_seq)
      VALUES ('0001/2425', '2024-05-01', '3902', 100, 100, '2024-25', 1)`).run()
    expect(() => deleteHsn(db, '3902')).toThrow(/1 purchase/)
    expect(listHsn(db)).toHaveLength(1)
  })

  it('refuses to delete a product an invoice still uses', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    // The parent purchase carries a different HSN, so only the allocation references 3902 —
    // this isolates the invoice branch of the guard from the purchase branch.
    db.prepare(`INSERT INTO purchases (our_code, invoice_date, hsn_code, qty_kg, qty_remaining_kg, fy_label, code_seq)
      VALUES ('0001/2425', '2024-05-01', '3901', 100, 90, '2024-25', 1)`).run()
    db.prepare(`INSERT INTO sales (invoice_number, seq, fy_label) VALUES ('RP/001/2024-25', 1, '2024-25')`).run()
    db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (1, 1, '3902', 5, 10, 100, 1000)`).run()
    expect(() => deleteHsn(db, '3902')).toThrow(/1 invoice/)
    expect(listHsn(db)).toHaveLength(1)
  })

  it('deleting a code that does not exist is a no-op', () => {
    expect(() => deleteHsn(db, '9999')).not.toThrow()
  })
})
