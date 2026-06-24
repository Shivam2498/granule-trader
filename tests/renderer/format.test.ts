import { describe, it, expect } from 'vitest'
import { formatINR } from '../../src/renderer/lib/format'
describe('formatINR', () => {
  it('uses Indian grouping with two decimals', () => { expect(formatINR(1180)).toBe('₹1,180.00') })
  it('groups lakhs', () => { expect(formatINR(125000.5)).toBe('₹1,25,000.50') })
})
