import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createCustomer, listCustomers, deleteCustomer, placeOfSupplyState } from '../../src/main/core/customers'

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
  it('deletes a customer with no sales', () => {
    const saved = createCustomer(db, c)
    deleteCustomer(db, saved.id)
    expect(listCustomers(db)).toHaveLength(0)
  })
  it('blocks deletion when the customer has sales', () => {
    const saved = createCustomer(db, c)
    db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date, buyer_customer_id)
      VALUES ('RP/001/2024-25','RP',1,'2024-25','created','2024-05-10',?)`).run(saved.id)
    expect(() => deleteCustomer(db, saved.id)).toThrow(/has sales and cannot be deleted/)
    expect(listCustomers(db)).toHaveLength(1)
  })
})
