import { describe, it, expect } from 'vitest'
import { financialYear, listFinancialYears } from '../../src/main/core/financial-year'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase, nextPurchaseCode } from '../../src/main/core/purchase'

describe('financialYear', () => {
  it('April starts a new FY', () => {
    expect(financialYear('2024-04-01')).toEqual({ startYear: 2024, endYear: 2025, code: '2425', label: '2024-25' })
  })
  it('March belongs to the prior FY start', () => {
    expect(financialYear('2025-03-31')).toEqual({ startYear: 2024, endYear: 2025, code: '2425', label: '2024-25' })
  })
  it('January belongs to the prior FY start', () => {
    expect(financialYear('2025-01-15').label).toBe('2024-25')
  })
  it('December belongs to the current FY start', () => {
    expect(financialYear('2024-12-15').label).toBe('2024-25')
  })
})

describe('listFinancialYears', () => {
  it('returns distinct labels across purchases and sales, newest first', () => {
    const db = openDatabase(':memory:')
    const base = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', qty_kg: 100, amount: 1000, gst_rate: 18, homeState: 'Gujarat' }
    createPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2024-05-01'), invoice_date: '2024-05-01' }) // FY 2024-25
    createPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2025-06-01'), invoice_date: '2025-06-01' }) // FY 2025-26
    db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date) VALUES ('RP/1','RP',1,'2024-25','created','2024-05-10')`).run()
    expect(listFinancialYears(db)).toEqual(['2025-26', '2024-25'])
    db.close()
  })
  it('returns an empty array on a fresh database', () => {
    const db = openDatabase(':memory:')
    expect(listFinancialYears(db)).toEqual([])
    db.close()
  })
})
