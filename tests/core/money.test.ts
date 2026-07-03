import { describe, it, expect } from 'vitest'
import { round2 } from '../../src/main/core/money'

describe('round2', () => {
  it('rounds to two decimals', () => { expect(round2(1.005)).toBe(1.01) })
  it('removes float drift', () => { expect(round2(0.1 + 0.2)).toBe(0.3) })
  it('leaves whole numbers', () => { expect(round2(100)).toBe(100) })
  it('rounds negative half-values symmetrically (away from zero)', () => {
    expect(round2(-1.005)).toBe(-1.01)
    expect(round2(-100)).toBe(-100)
    expect(round2(-0.1 - 0.2)).toBe(-0.3)
  })
})
