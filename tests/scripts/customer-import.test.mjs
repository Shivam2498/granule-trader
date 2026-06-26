import { describe, it, expect } from 'vitest'
import { parseCsv, mapCustomerRows } from '../../scripts/customer-import.mjs'

describe('parseCsv', () => {
  it('parses comma CSV with a quoted field containing a comma', () => {
    const rows = parseCsv('Name,City\n"Acme, Inc",Kolkata\n')
    expect(rows).toEqual([['Name', 'City'], ['Acme, Inc', 'Kolkata']])
  })
  it('auto-detects tab-separated and handles CRLF', () => {
    const rows = parseCsv('Name\tCity\r\nAcme\tKolkata\r\n')
    expect(rows).toEqual([['Name', 'City'], ['Acme', 'Kolkata']])
  })
  it('un-escapes doubled quotes and skips blank lines', () => {
    const rows = parseCsv('Name\n"He said ""hi"""\n\n')
    expect(rows).toEqual([['Name'], ['He said "hi"']])
  })
})

describe('mapCustomerRows', () => {
  const header = 'Sl No,Customer Name,Address,City,State,Pincode,Phone,GSTIN,PAN No.'

  it('maps the columns, ignores Sl No, mirrors shipping to billing', () => {
    const { toImport, skipped } = mapCustomerRows(parseCsv(
      `${header}\n1,Acme Traders,12 MG Road,Kolkata,West Bengal,700001,9876543210,19ABCDE1234F1Z5,ABCDE1234F\n`))
    expect(skipped).toEqual([])
    expect(toImport).toHaveLength(1)
    expect(toImport[0]).toEqual({
      name: 'Acme Traders', gstin: '19ABCDE1234F1Z5', pan: 'ABCDE1234F', phone: '9876543210',
      billing_address: '12 MG Road', billing_city: 'Kolkata', billing_state: 'West Bengal', billing_pincode: '700001',
      shipping_same: true,
      shipping_address: '12 MG Road', shipping_city: 'Kolkata', shipping_state: 'West Bengal', shipping_pincode: '700001',
    })
  })

  it('derives PAN from GSTIN when the PAN column is blank', () => {
    const { toImport } = mapCustomerRows(parseCsv(`${header}\n2,Beta,Addr,City,State,700002,,19ABCDE1234F1Z5,\n`))
    expect(toImport[0].pan).toBe('ABCDE1234F')
  })

  it('imports a row with no GSTIN (unregistered buyer)', () => {
    const { toImport, skipped } = mapCustomerRows(parseCsv(`${header}\n3,Gamma,Addr,City,State,700003,123,,\n`))
    expect(skipped).toEqual([])
    expect(toImport[0]).toMatchObject({ name: 'Gamma', gstin: '', pan: '' })
  })

  it('skips a row missing the Customer Name', () => {
    const { toImport, skipped } = mapCustomerRows(parseCsv(`${header}\n4,,Addr,City,State,700004,,,\n`))
    expect(toImport).toEqual([])
    expect(skipped).toEqual([{ line: 2, name: '', reason: 'missing Customer Name' }])
  })

  it('skips a row with a malformed GSTIN and reports it', () => {
    const { toImport, skipped } = mapCustomerRows(parseCsv(`${header}\n5,Delta,Addr,City,State,700005,,NOTAGSTIN,\n`))
    expect(toImport).toEqual([])
    expect(skipped[0]).toMatchObject({ line: 2, name: 'Delta', reason: 'invalid GSTIN "NOTAGSTIN"' })
  })
})
