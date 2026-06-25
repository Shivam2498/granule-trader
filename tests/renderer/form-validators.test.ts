import { describe, it, expect } from 'vitest'
import { vGstin, vPhone, vPincode } from '../../src/renderer/lib/formValidators'
import { VMSG } from '../../src/shared/validation'

describe('form validators', () => {
  it('vGstin: null when valid, VMSG.gstin when not', () => {
    expect(vGstin('24CCGPC8555A1Z5')).toBeNull()
    expect(vGstin('nope')).toBe(VMSG.gstin)
  })
  it('vPhone: null when 10 digits, VMSG.phone when not', () => {
    expect(vPhone('9876543210')).toBeNull()
    expect(vPhone('123')).toBe(VMSG.phone)
  })
  it('vPincode: null when 6 digits, VMSG.pincode when not', () => {
    expect(vPincode('395003')).toBeNull()
    expect(vPincode('99')).toBe(VMSG.pincode)
  })
})
