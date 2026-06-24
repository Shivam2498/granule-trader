import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { reserveGaps, validateInvoiceOrder } from '../../src/main/core/invoice-validation'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

function created(seq: number, date: string) {
  db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
    VALUES (?, 'RP', ?, '2024-25', 'created', ?)`).run(`RP/${String(seq).padStart(3,'0')}/2024-25`, seq, date)
}

describe('reserveGaps', () => {
  it('creates blank reserved rows for skipped numbers', () => {
    reserveGaps(db, 'RP', '2024-25', 8, 11)   // reserve 9 and 10
    const rows = db.prepare("SELECT seq, status, invoice_date FROM sales WHERE fy_label='2024-25' ORDER BY seq").all() as any[]
    expect(rows.map(r => r.seq)).toEqual([9, 10])
    expect(rows.every(r => r.status === 'reserved' && r.invoice_date === null)).toBe(true)
  })
})

describe('validateInvoiceOrder', () => {
  beforeEach(() => { created(5, '2024-05-10'); created(7, '2024-05-20') })
  it('accepts a date inside the window for seq 6', () => {
    expect(validateInvoiceOrder(db, { fyLabel: '2024-25', seq: 6, invoiceDate: '2024-05-15' }).ok).toBe(true)
  })
  it('rejects a date before the earlier-numbered bill', () => {
    const r = validateInvoiceOrder(db, { fyLabel: '2024-25', seq: 6, invoiceDate: '2024-05-09' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('on or after')
  })
  it('rejects a date after the later-numbered bill', () => {
    const r = validateInvoiceOrder(db, { fyLabel: '2024-25', seq: 6, invoiceDate: '2024-05-21' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('on or before')
  })
})
