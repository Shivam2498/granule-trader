import { describe, it, expect } from 'vitest'
import { searchAll, flatHits, type SearchData } from '../../src/renderer/lib/search'
import type { Sale, Purchase, Customer, Supplier, LedgerRow } from '../../src/shared/types'

const data: SearchData = {
  sales: [
    { id: 1, status: 'created', invoice_number: 'RP/039/2026-27', buyer_name: 'Jenisa Enterprise',
      buyer_gstin: '19ABCDE', total_invoice_amount: 18499.99 } as Sale,
    { id: 2, status: 'reserved', invoice_number: '', buyer_name: 'Jenisa Enterprise' } as Sale, // draft: excluded
  ],
  purchases: [
    { id: 5, our_code: '040/2627', party: 'Swastik Polymers', supplier_invoice_number: 'S-77', hsn_code: '320419' } as Purchase,
  ],
  customers: [
    { id: 7, name: 'Jenisa Enterprise', gstin: '19ABCDE', phone: '900', email: '', billing_city: 'Kolkata' } as Customer,
    { id: 8, name: 'Acme', gstin: '', phone: '', email: '', billing_city: 'Howrah' } as Customer,
  ],
  suppliers: [
    { id: 3, name: 'Swastik Polymers', gstin: '19XYZ', phone: '', email: '', city: 'Haldia' } as Supplier,
  ],
  ledger: [
    { purchase_item_id: 11, our_code: '040/2627', hsn_code: '320419', party: 'Swastik Polymers', balance_kg: 500 } as LedgerRow,
  ],
}

describe('searchAll', () => {
  it('returns nothing under two characters', () => {
    expect(searchAll('j', data)).toEqual([])
    expect(searchAll('  ', data)).toEqual([])
  })

  it('finds a customer and their invoice by name, excludes draft sales', () => {
    const groups = searchAll('jenisa', data)
    const byGroup = Object.fromEntries(groups.map(g => [g.group, g.hits]))
    expect(byGroup['Invoices'].map(h => h.title)).toEqual(['RP/039/2026-27'])   // only the created one
    expect(byGroup['Customers'].map(h => h.title)).toEqual(['Jenisa Enterprise'])
    expect(byGroup['Customers'][0].to).toBe('/customers/edit/7')
    expect(byGroup['Invoices'][0].to).toBe('/invoice/1')
  })

  it('matches an invoice number and a lot code across groups', () => {
    const groups = searchAll('040/2627', data)
    const groupsHit = groups.map(g => g.group)
    expect(groupsHit).toContain('Purchases')
    expect(groupsHit).toContain('Stock lots')
    const lot = groups.find(g => g.group === 'Stock lots')!.hits[0]
    expect(lot.subtitle).toContain('500 kg')
    expect(lot.to).toBe('/stock')
  })

  it('matches by a buried field (GSTIN) with lower priority than a title match', () => {
    const groups = searchAll('19XYZ', data)
    expect(groups.map(g => g.group)).toEqual(['Suppliers'])
    expect(groups[0].hits[0].score).toBe(1)   // matched on gstin, not the name
  })

  it('flatHits flattens in display order for keyboard nav', () => {
    const flat = flatHits(searchAll('jenisa', data))
    expect(flat[0].group).toBe('Invoices')
    expect(flat.at(-1)!.group).toBe('Customers')
  })
})
