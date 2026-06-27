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
  const okForm = () => ({ invoiceNumber: 'INV-001', hasBuyer: true, vehicle: 'GJ-05-AB-1234', lots: [lot({ qty: 50, rate: 8 })] })

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
})
