import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createCustomer, listCustomers, placeOfSupplyState } from '../../src/main/core/customers'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })
const c = {
  name: 'Beta Traders', gstin: '24XXX', pan: 'AAA', phone: '999',
  billing_address: 'A', billing_city: 'Surat', billing_state: 'Gujarat', billing_pincode: '395003',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

describe('customers', () => {
  it('creates and searches by name', () => {
    createCustomer(db, c)
    expect(listCustomers(db, 'beta')).toHaveLength(1)
    expect(listCustomers(db, 'zzz')).toHaveLength(0)
  })
  it('place of supply falls back to billing when shipping is same', () => {
    const saved = createCustomer(db, c)
    expect(placeOfSupplyState(saved)).toBe('Gujarat')
  })
  it('place of supply uses shipping state when different', () => {
    const saved = createCustomer(db, { ...c, shipping_same: false, shipping_state: 'Maharashtra' })
    expect(placeOfSupplyState(saved)).toBe('Maharashtra')
  })
})
