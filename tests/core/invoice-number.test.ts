import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { formatInvoiceNumber, parseInvoiceNumber, nextInvoiceNumber } from '../../src/main/core/invoice-number'

describe('format/parse', () => {
  it('formats with 3-digit sequence', () => {
    expect(formatInvoiceNumber('RP', 8, '2024-25')).toBe('RP/008/2024-25')
  })
  it('round-trips a parse', () => {
    expect(parseInvoiceNumber('RP/008/2024-25')).toEqual({ prefix: 'RP', seq: 8, fyLabel: '2024-25' })
  })
  it('returns null on garbage', () => {
    expect(parseInvoiceNumber('nope')).toBeNull()
  })
})

describe('nextInvoiceNumber', () => {
  let db: ReturnType<typeof openDatabase>
  beforeEach(() => { db = openDatabase(':memory:') })
  it('starts at 001 for an empty FY', () => {
    expect(nextInvoiceNumber(db, '2024-05-01', 'RP')).toBe('RP/001/2024-25')
  })
  it('continues past existing rows in the FY', () => {
    db.prepare("INSERT INTO sales (invoice_number, prefix, seq, fy_label, status) VALUES ('RP/004/2024-25','RP',4,'2024-25','created')").run()
    expect(nextInvoiceNumber(db, '2024-06-01', 'RP')).toBe('RP/005/2024-25')
  })
})
