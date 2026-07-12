import { describe, it, expect } from 'vitest'
import { saleFormError } from '../../src/renderer/lib/sale-validation'
import { newLine, type SaleLineDraft } from '../../src/renderer/lib/sale-lines'
import type { AvailableLot } from '../../src/shared/types'

const lot = (o: Partial<AvailableLot> & { purchase_item_id: number }): AvailableLot => ({
  purchase_id: 1, our_code: `LOT${o.purchase_item_id}`, party: 'Reliance', hsn_code: 'PP',
  description: 'PP', invoice_date: '2026-01-12', rate_per_kg: 80, available_kg: 1000, ...o
})

const LOTS = [lot({ purchase_item_id: 1, available_kg: 1000 }), lot({ purchase_item_id: 2, hsn_code: 'HDPE', available_kg: 500 })]

describe('saleFormError', () => {
  const okForm = () => ({
    invoiceNumber: 'INV-001', hasBuyer: true, vehicle: 'GJ-05-AB-1234',
    lines: [newLine(LOTS, 'PP', 50, 8)],
    lots: LOTS,
    total: 472, ewayNo: '', ewayDate: ''
  })

  it('requires an invoice number', () => {
    expect(saleFormError({ ...okForm(), invoiceNumber: '   ' })).toBe('Enter an invoice number.')
  })
  it('requires a buyer first', () => {
    expect(saleFormError({ ...okForm(), hasBuyer: false })).toBe('Please choose a buyer.')
  })
  it('requires a vehicle number', () => {
    expect(saleFormError({ ...okForm(), vehicle: '   ' })).toBe('Enter the vehicle number.')
  })
  it('asks for a material when nothing has been added', () => {
    expect(saleFormError({ ...okForm(), lines: [] })).toBe('Add at least one material to sell.')
  })
  it('names the material whose line is incomplete', () => {
    const line: SaleLineDraft = { ...newLine(LOTS, 'PP', 50, 8), rate_per_kg: 0 }
    expect(saleFormError({ ...okForm(), lines: [line] })).toBe('PP: Enter a selling rate.')
  })
  it('surfaces a line that asks for more than the material has', () => {
    const line: SaleLineDraft = { ...newLine(LOTS, 'HDPE', 500, 8), qty_kg: 9999 }
    expect(saleFormError({ ...okForm(), lines: [line] }))
      .toBe('HDPE: Only 500 kg of HDPE is available — you asked for 9999 kg.')
  })
  it('returns empty for a fully valid form', () => {
    expect(saleFormError(okForm())).toBe('')
  })

  describe('e-way bill over ₹50,000', () => {
    it('does not ask for an e-way bill at or below the threshold', () => {
      expect(saleFormError({ ...okForm(), total: 50000 })).toBe('')
    })
    it('requires the e-way bill number once the invoice total passes 50,000', () => {
      expect(saleFormError({ ...okForm(), total: 53100 }))
        .toBe('This sale comes to ₹53,100.00, which is over ₹50,000.00 — enter the e-way bill number.')
    })
    it('then requires the e-way bill date', () => {
      expect(saleFormError({ ...okForm(), total: 53100, ewayNo: '391000123456' }))
        .toBe('This sale comes to ₹53,100.00, which is over ₹50,000.00 — enter the e-way bill date.')
    })
    it('is satisfied once both the number and date are filled in', () => {
      expect(saleFormError({ ...okForm(), total: 53100, ewayNo: '391000123456', ewayDate: '2024-05-10' })).toBe('')
    })
    it('treats blank-but-spaces as missing', () => {
      expect(saleFormError({ ...okForm(), total: 53100, ewayNo: '   ' }))
        .toContain('enter the e-way bill number')
    })
    it('asks for the goods before the e-way bill, since the total depends on them', () => {
      expect(saleFormError({ ...okForm(), total: 53100, lines: [] }))
        .toBe('Add at least one material to sell.')
    })
  })
})
