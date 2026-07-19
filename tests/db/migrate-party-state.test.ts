import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { initSchema } from '../../src/main/db/schema'

/**
 * v3 backfills the state the purchase CSV importer never set (it created suppliers by name only).
 * A blank state reads as inter-state — so tax would silently book IGST on the next edit. The
 * backfill is evidence-driven: a supplier only gets the home state when their OWN bills were
 * taxed intra-state (CGST/SGST, no IGST). Anything ambiguous is left blank for the user to decide.
 */
function dbAtVersion2() {
  const db = openDatabase(':memory:')       // full current schema
  db.prepare(`INSERT INTO settings(key,value) VALUES('home_state','West Bengal')
              ON CONFLICT(key) DO UPDATE SET value='West Bengal'`).run()
  db.prepare(`UPDATE settings SET value='2' WHERE key='schema_version'`).run()   // pretend pre-v3
  return db
}
const addSupplier = (db: any, name: string, state = '') =>
  Number(db.prepare(`INSERT INTO suppliers (name, state) VALUES (?, ?)`).run(name, state).lastInsertRowid)
const addPurchase = (db: any, supplierId: number, code: string, cgst: number, igst: number, partyState = '') =>
  db.prepare(`INSERT INTO purchases (our_code, invoice_date, hsn_code, qty_kg, qty_remaining_kg,
    fy_label, code_seq, supplier_id, party_state, cgst, sgst, igst)
    VALUES (?, '2026-02-01', '3902', 100, 100, '2025-26', 1, ?, ?, ?, ?, ?)`)
    .run(code, supplierId, partyState, cgst, cgst, igst)

describe('migration v3 — backfill party state from how the bills were actually taxed', () => {
  it('fills the home state for a supplier whose bills were all intra-state', () => {
    const db = dbAtVersion2()
    const id = addSupplier(db, 'Swastik')          // blank state, like the importer left it
    addPurchase(db, id, '001/2526', 4590, 0)
    addPurchase(db, id, '002/2526', 2754, 0)

    initSchema(db)

    expect((db.prepare('SELECT state FROM suppliers WHERE id=?').get(id) as any).state).toBe('West Bengal')
  })

  it('leaves a supplier blank when any bill was inter-state — never guesses', () => {
    const db = dbAtVersion2()
    const id = addSupplier(db, 'Gujarat Polymers')
    addPurchase(db, id, '003/2526', 0, 1800)       // IGST bill = genuinely out of state
    initSchema(db)
    expect((db.prepare('SELECT state FROM suppliers WHERE id=?').get(id) as any).state).toBe('')
  })

  it('leaves a supplier with no bills blank — no evidence to infer from', () => {
    const db = dbAtVersion2()
    const id = addSupplier(db, 'Brand New Supplier')
    initSchema(db)
    expect((db.prepare('SELECT state FROM suppliers WHERE id=?').get(id) as any).state).toBe('')
  })

  it('never overwrites a state that is already set', () => {
    const db = dbAtVersion2()
    const id = addSupplier(db, 'Haldia', 'Maharashtra')   // deliberately not the home state
    addPurchase(db, id, '004/2526', 4590, 0)
    initSchema(db)
    expect((db.prepare('SELECT state FROM suppliers WHERE id=?').get(id) as any).state).toBe('Maharashtra')
  })

  it('backfills the purchase record’s own party_state for intra-state bills', () => {
    const db = dbAtVersion2()
    const id = addSupplier(db, 'Swastik')
    addPurchase(db, id, '005/2526', 4590, 0)
    initSchema(db)
    expect((db.prepare(`SELECT party_state FROM purchases WHERE our_code='005/2526'`).get() as any).party_state).toBe('West Bengal')
  })

  it('leaves an IGST bill’s party_state blank', () => {
    const db = dbAtVersion2()
    const id = addSupplier(db, 'Gujarat Polymers')
    addPurchase(db, id, '006/2526', 0, 1800)
    initSchema(db)
    expect((db.prepare(`SELECT party_state FROM purchases WHERE our_code='006/2526'`).get() as any).party_state).toBe('')
  })

  it('is idempotent and stamps version 3', () => {
    const db = dbAtVersion2()
    const id = addSupplier(db, 'Swastik')
    addPurchase(db, id, '007/2526', 4590, 0)
    initSchema(db)
    initSchema(db)
    expect((db.prepare('SELECT state FROM suppliers WHERE id=?').get(id) as any).state).toBe('West Bengal')
    expect((db.prepare(`SELECT value FROM settings WHERE key='schema_version'`).get() as any).value).toBe('3')
  })

  it('does nothing when the home state is not set — cannot infer without it', () => {
    const db = dbAtVersion2()
    db.prepare(`UPDATE settings SET value='' WHERE key='home_state'`).run()
    const id = addSupplier(db, 'Swastik')
    addPurchase(db, id, '008/2526', 4590, 0)
    initSchema(db)
    expect((db.prepare('SELECT state FROM suppliers WHERE id=?').get(id) as any).state).toBe('')
  })

  it('a fresh database just stamps version 3', () => {
    const db = openDatabase(':memory:')
    expect((db.prepare(`SELECT value FROM settings WHERE key='schema_version'`).get() as any).value).toBe('3')
  })
})
