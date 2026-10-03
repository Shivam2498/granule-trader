import { describe, it, expect } from 'vitest'
import { lotDrawError, saleFormError } from '../../src/renderer/lib/sale-validation'

const lot = (o: Partial<{ our_code: string; qty: number; rate: number; available: number }> = {}) =>
  ({ our_code: '0012/2526', qty: 10, rate: 5, available: 100, ...o })

describe('lotDrawError', () => {
  it('flags a missing quantity', () => {
    expect(lotDrawError(lot({ qty: 0 }))).toBe('Enter a quantity.')
  })
  it('flags an over-draw with the available amount', () => {
    expect(lotDrawError(lot({ qty: 150, available: 100 }))).toBe('Only 100 kg available in this lot.')
  })
  it('flags a missing rate once qty is within range', () => {
    expect(lotDrawError(lot({ qty: 50, rate: 0 }))).toBe('Enter a selling rate.')
  })
  it('returns empty for a valid lot', () => {
    expect(lotDrawError(lot({ qty: 50, rate: 8, available: 100 }))).toBe('')
  })
  it('allows drawing exactly the available amount', () => {
    expect(lotDrawError(lot({ qty: 100, available: 100, rate: 8 }))).toBe('')
  })
})

describe('saleFormError', () => {
  const okForm = () => ({
    invoiceNumber: 'INV-001', hasBuyer: true, vehicle: 'GJ-05-AB-1234',
    lots: [lot({ qty: 50, rate: 8 })],
    placeOfSupply: 'West Bengal',
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
  it('asks you to choose stock when no lot has been added', () => {
    expect(saleFormError({ ...okForm(), lots: [] })).toBe('Choose stock to sell.')
  })
  it('names the lot whose row is incomplete', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ our_code: '0019/2526', qty: 0 })] }))
      .toBe('0019/2526: Enter a quantity.')
  })
  it('surfaces an over-drawn lot', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ our_code: '0019/2526', qty: 150, available: 100, rate: 8 })] }))
      .toBe('0019/2526: Only 100 kg available in this lot.')
  })
  it('surfaces a missing rate on a chosen lot', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ our_code: '0019/2526', qty: 50, rate: 0 })] }))
      .toBe('0019/2526: Enter a selling rate.')
  })
  it('returns empty for a fully valid form', () => {
    expect(saleFormError(okForm())).toBe('')
  })
  it('refuses to save while a chosen lot is not in stock on the invoice date', () => {
    expect(saleFormError({ ...okForm(), unavailableLots: 1 }))
      .toBe("1 chosen lot isn't in stock on the invoice date. Move the date later, or remove it.")
    expect(saleFormError({ ...okForm(), unavailableLots: 2 }))
      .toBe("2 chosen lots aren't in stock on the invoice date. Move the date later, or remove them.")
  })
  it('names unavailable lots even when no other lot remains', () => {
    expect(saleFormError({ ...okForm(), lots: [], unavailableLots: 1 }))
      .toBe("1 chosen lot isn't in stock on the invoice date. Move the date later, or remove it.")
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
    it('asks for the stock before the e-way bill, since the total depends on it', () => {
      expect(saleFormError({ ...okForm(), total: 53100, lots: [] })).toBe('Choose stock to sell.')
    })
  })
})

describe('buyer state guard (tax must never be derived from a blank state)', () => {
  const okForm = () => ({
    invoiceNumber: 'INV-001', hasBuyer: true, vehicle: 'GJ-05-AB-1234',
    lots: [lot({ qty: 50, rate: 8 })],
    placeOfSupply: 'West Bengal',
    total: 472, ewayNo: '', ewayDate: ''
  })
  it('refuses to save when the buyer has no state — GST could not be worked out', () => {
    expect(saleFormError({ ...okForm(), placeOfSupply: '' }))
      .toBe('This buyer has no state set, so GST cannot be worked out. Press Edit next to the buyer and set their state.')
  })
  it('asks for the buyer before complaining about their state', () => {
    expect(saleFormError({ ...okForm(), hasBuyer: false, placeOfSupply: '' })).toBe('Please choose a buyer.')
  })
  it('passes when the state is set', () => {
    expect(saleFormError(okForm())).toBe('')
  })
})
