import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createSupplier, updateSupplier, getSupplier, listSuppliers, deleteSupplier } from '../../src/main/core/suppliers'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const s = {
  name: 'Acme Polymers', gstin: '24CCGPC8555A1Z5', pan: 'CCGPC8555A', phone: '9876543210',
  address: '1 Industrial Estate', city: 'Surat', state: 'Gujarat', pincode: '395003'
}

describe('suppliers', () => {
  it('creates and reads back every field', () => {
    const saved = createSupplier(db, s)
    expect(saved.id).toBeGreaterThan(0)
    expect(getSupplier(db, saved.id)).toMatchObject(s)
  })
  it('lists ordered by name and filters by name or gstin', () => {
    createSupplier(db, { ...s, name: 'Zeta Plast', gstin: '24ZZZPZ0000Z1Z5' })
    createSupplier(db, s)
    expect(listSuppliers(db).map(x => x.name)).toEqual(['Acme Polymers', 'Zeta Plast'])
    expect(listSuppliers(db, 'acme')).toHaveLength(1)
    expect(listSuppliers(db, 'ZZZPZ')).toHaveLength(1)
    expect(listSuppliers(db, 'nope')).toHaveLength(0)
  })
  it('updates an existing supplier', () => {
    const saved = createSupplier(db, s)
    updateSupplier(db, saved.id, { ...s, city: 'Vapi' })
    expect(getSupplier(db, saved.id)!.city).toBe('Vapi')
  })
  it('deletes a supplier', () => {
    const saved = createSupplier(db, s)
    deleteSupplier(db, saved.id)
    expect(getSupplier(db, saved.id)).toBeUndefined()
  })
})
