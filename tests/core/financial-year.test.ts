import { describe, it, expect } from 'vitest'
import { financialYear } from '../../src/main/core/financial-year'

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
