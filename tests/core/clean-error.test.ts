import { describe, it, expect } from 'vitest'
import { cleanIpcError } from '../../src/shared/clean-error'

describe('cleanIpcError', () => {
  it('strips the Electron IPC wrapper and Error: prefix', () => {
    const e = new Error("Error invoking remote method 'createPurchase': Error: Purchase code 0001/2627 already exists.")
    expect(cleanIpcError(e)).toBe('Purchase code 0001/2627 already exists.')
  })
  it('strips a named-Error prefix (e.g. SqliteError)', () => {
    const e = new Error("Error invoking remote method 'createSale': SqliteError: UNIQUE constraint failed: sales.fy_label, sales.seq")
    expect(cleanIpcError(e)).toBe('UNIQUE constraint failed: sales.fy_label, sales.seq')
  })
  it('leaves a plain message unchanged', () => {
    expect(cleanIpcError(new Error('Something went wrong.'))).toBe('Something went wrong.')
  })
  it('handles non-Error values', () => {
    expect(cleanIpcError('boom')).toBe('boom')
  })
})
