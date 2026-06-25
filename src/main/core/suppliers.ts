import type Database from 'better-sqlite3'
import type { Supplier } from '@shared/types'

const COLS = `name, gstin, pan, phone, address, city, state, pincode`

export function createSupplier(db: Database.Database, s: Omit<Supplier, 'id'>): Supplier {
  const info = db.prepare(`INSERT INTO suppliers (${COLS}) VALUES
    (@name,@gstin,@pan,@phone,@address,@city,@state,@pincode)`).run(s)
  return getSupplier(db, Number(info.lastInsertRowid))!
}

export function updateSupplier(db: Database.Database, id: number, s: Omit<Supplier, 'id'>): Supplier {
  db.prepare(`UPDATE suppliers SET name=@name, gstin=@gstin, pan=@pan, phone=@phone,
    address=@address, city=@city, state=@state, pincode=@pincode WHERE id=@id`).run({ ...s, id })
  return getSupplier(db, id)!
}

export function getSupplier(db: Database.Database, id: number): Supplier | undefined {
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined
}

export function listSuppliers(db: Database.Database, search?: string): Supplier[] {
  return (search
    ? db.prepare(`SELECT * FROM suppliers WHERE name LIKE ? OR gstin LIKE ? ORDER BY name`).all(`%${search}%`, `%${search}%`)
    : db.prepare('SELECT * FROM suppliers ORDER BY name').all()) as Supplier[]
}

export function deleteSupplier(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
}
