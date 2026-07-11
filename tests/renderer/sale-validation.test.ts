import { describe, it, expect } from 'vitest'
import { lotDrawError, saleFormError } from '../../src/renderer/lib/sale-validation'

const lot = (o: Partial<{ include: boolean; qty: number; rate: number; available: number }> = {}) =>
  ({ include: true, qty: 10, rate: 5, available: 100, ...o })

describe('lotDrawError', () => {
  it('returns empty when the lot is not included', () => {
    expect(lotDrawError(lot({ include: false, qty: 9999 }))).toBe('')
  })
  it('flags a missing quantity', () => {
    expect(lotDrawError(lot({ qty: 0 }))).toBe('Enter a quantity.')
  })
  it('flags an over-draw with the available amount', () => {
    expect(lotDrawError(lot({ qty: 150, available: 100 }))).toBe('Only 100 kg available in this lot.')
  })
  it('flags a missing rate once qty is within range', () => {
    expect(lotDrawError(lot({ qty: 50, rate: 0 }))).toBe('Enter a selling rate.')
  })
  it('returns empty for a valid included lot', () => {
    expect(lotDrawError(lot({ qty: 50, rate: 8, available: 100 }))).toBe('')
  })
  it('allows drawing exactly the available amount', () => {
    expect(lotDrawError(lot({ qty: 100, available: 100, rate: 8 }))).toBe('')
  })
})

describe('saleFormError', () => {
  const okForm = () => ({
    invoiceNumber: 'INV-001', hasBuyer: true, vehicle: 'GJ-05-AB-1234', lots: [lot({ qty: 50, rate: 8 })],
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
  it('asks to tick a lot only when none is ticked', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ include: false })] }))
      .toBe('Tick at least one stock lot, then enter its quantity and selling rate.')
  })
  it('asks for the quantity when the only ticked lot has none', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ include: true, qty: 0 })] }))
      .toBe('Enter a quantity.')
  })
  it('surfaces an over-drawn lot', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ qty: 150, available: 100, rate: 8 })] }))
      .toBe('Only 100 kg available in this lot.')
  })
  it('surfaces a missing rate on a ticked lot', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ qty: 50, rate: 0 })] }))
      .toBe('Enter a selling rate.')
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
    it('asks for the lots before the e-way bill, since the total depends on them', () => {
      expect(saleFormError({ ...okForm(), total: 53100, lots: [lot({ include: false })] }))
        .toBe('Tick at least one stock lot, then enter its quantity and selling rate.')
    })
  })
})
