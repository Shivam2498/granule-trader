import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readWorkbook } from '../../scripts/xlsx-lite.mjs'

const WB = '/Users/shivamchoudhary/Downloads/DataMigration.xlsx'

describe.runIf(existsSync(WB))('readWorkbook (real workbook)', () => {
  const wb = readWorkbook(WB)
  it('exposes the four expected sheets', () => {
    expect(Object.keys(wb).sort()).toEqual(
      ['CustomerMaster', 'PurchaseInvoiceMaster', 'SaleInvoiceMaster', 'Stock'].sort()
    )
  })
  it('reads a known SaleInvoiceMaster cell (first invoice number)', () => {
    const rows = wb.SaleInvoiceMaster
    const flat = rows.flat()
    expect(flat).toContain('RP/001/2026-27')
  })
  it('reads the Stock sheet lot code with its Code prefix', () => {
    expect(wb.Stock.flat().some(c => c.startsWith('Code 082/2526'))).toBe(true)
  })
})
