import type Database from 'better-sqlite3'
import type { Customer } from '@shared/types'

const COLS = `name, gstin, pan, phone, billing_address, billing_city, billing_state, billing_pincode,
  shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode`

function rowToCustomer(r: any): Customer { return { ...r, shipping_same: !!r.shipping_same } }

export function createCustomer(db: Database.Database, c: Omit<Customer, 'id'>): Customer {
  const info = db.prepare(`INSERT INTO customers (${COLS}) VALUES
    (@name,@gstin,@pan,@phone,@billing_address,@billing_city,@billing_state,@billing_pincode,
     @shipping_same,@shipping_address,@shipping_city,@shipping_state,@shipping_pincode)`)
    .run({ ...c, shipping_same: c.shipping_same ? 1 : 0 })
  return getCustomer(db, Number(info.lastInsertRowid))!
}

export function updateCustomer(db: Database.Database, id: number, c: Omit<Customer, 'id'>): Customer {
  db.prepare(`UPDATE customers SET name=@name, gstin=@gstin, pan=@pan, phone=@phone,
    billing_address=@billing_address, billing_city=@billing_city, billing_state=@billing_state,
    billing_pincode=@billing_pincode, shipping_same=@shipping_same, shipping_address=@shipping_address,
    shipping_city=@shipping_city, shipping_state=@shipping_state, shipping_pincode=@shipping_pincode
    WHERE id=@id`).run({ ...c, id, shipping_same: c.shipping_same ? 1 : 0 })
  return getCustomer(db, id)!
}

export function getCustomer(db: Database.Database, id: number): Customer | undefined {
  const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
  return r ? rowToCustomer(r) : undefined
}

export function listCustomers(db: Database.Database, search?: string): Customer[] {
  const rows = search
    ? db.prepare(`SELECT * FROM customers WHERE name LIKE ? OR gstin LIKE ? ORDER BY name`).all(`%${search}%`, `%${search}%`)
    : db.prepare('SELECT * FROM customers ORDER BY name').all()
  return (rows as any[]).map(rowToCustomer)
}

export function deleteCustomer(db: Database.Database, id: number): void {
  const count = db.prepare('SELECT COUNT(*) AS c FROM sales WHERE buyer_customer_id = ?').get(id) as { c: number }
  if (count.c > 0) throw new Error('This customer has sales and cannot be deleted.')
  db.prepare('DELETE FROM customers WHERE id = ?').run(id)
}

export function placeOfSupplyState(c: Customer): string {
  return c.shipping_same ? c.billing_state : (c.shipping_state || c.billing_state)
}
