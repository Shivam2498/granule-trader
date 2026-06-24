import { describe, it, expect } from 'vitest'
import { lookupPincode } from '../../src/renderer/lib/pincode'

describe('lookupPincode', () => {
  it('returns city + state for a known pincode', () => {
    const r = lookupPincode('395003')   // Surat, Gujarat
    expect(r).not.toBeNull()
    expect(r!.state.toLowerCase()).toContain('gujarat')
    expect(r!.city.length).toBeGreaterThan(0)
  })
  it('returns null for an invalid or unknown pincode', () => {
    expect(lookupPincode('abc')).toBeNull()
    expect(lookupPincode('000000')).toBeNull()
  })
})
