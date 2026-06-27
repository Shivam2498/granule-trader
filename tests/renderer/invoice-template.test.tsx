// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InvoiceTemplate from '../../src/renderer/invoice/InvoiceTemplate'
import type { Sale, SaleAllocation, Settings } from '@shared/types'

const settings = { seller_name: 'Shivam Traders', seller_address: 'Off Addr', seller_godown_address: 'Godown Addr',
  seller_gstin: '19ACNPC1217E1Z0', seller_pan: 'ACNPC1217E', seller_phone: '', seller_city: 'Kolkata', seller_pincode: '700001',
  home_state: 'West Bengal', seller_udyam: 'UDYAM-WB-10-0066963', seller_email: 'a@b.com',
  bank_name: 'ICICI BANK LIMITED', bank_branch: 'NEW ALIPORE', bank_account_no: '031705500675', bank_ifsc: 'ICIC0000317',
  invoice_prefix: 'ST', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10 } as Settings
const sale = { id: 1, invoice_number: 'ST/006/2025-26', invoice_date: '2025-04-14', buyer_name: 'SAMTA IMPEX',
  buyer_gstin: '19AAECM3696H1Z1', buyer_billing_json: '{"city":"Howrah","state":"West Bengal","pincode":"711405"}',
  buyer_shipping_json: '{}', place_of_supply_state: 'West Bengal', amount: 220340, cgst: 19830.6, sgst: 19830.6, igst: 0, tcs: 0, roundoff: -1.2,
  total_invoice_amount: 260000, total_qty_kg: 2000, vehicle: 'WB23E9212', eway_bill_no: '821520090058', eway_bill_date: '2025-04-14' } as unknown as Sale
const allocs = [{ id: 1, sale_id: 1, purchase_id: 1, hsn_code: '39023000', gst_rate: 18, qty_drawn_kg: 2000, rate_per_kg: 110.17, line_amount: 220340 }] as SaleAllocation[]
const hsnDescriptions = { '39023000': 'Plastic Granules' }

describe('InvoiceTemplate', () => {
  it('renders seller, buyer, invoice number, total and amount-in-words', () => {
    render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(screen.getAllByText('SHIVAM TRADERS').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ST\/006\/2025-26/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SAMTA IMPEX/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('PLASTIC GRANULES').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2,60,000\.00/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rupees Two lakh sixty thousand only').length).toBeGreaterThan(0)
  })
  it('shows the bank block and both copies', () => {
    render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(screen.getAllByText(/ICIC0000317/).length).toBeGreaterThan(0)
    expect(screen.getByText('Original')).toBeTruthy()
    expect(screen.getByText('Duplicate')).toBeTruthy()
  })
  it('always shows both Buyer and Consignee, identical when shipping equals billing', () => {
    render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(screen.getAllByText('Buyer (if other than consignee)').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Consignee').length).toBeGreaterThan(0)
    // Buyer name appears in both columns of each of the two copies (4 total).
    expect(screen.getAllByText(/SAMTA IMPEX/).length).toBe(4)
  })

  it('shows the distinct consignee address when shipping differs', () => {
    const shipSale = { ...sale, buyer_shipping_json: '{"address":"Plot 9","city":"Durgapur","state":"West Bengal","pincode":"713201"}' } as unknown as Sale
    render(<InvoiceTemplate sale={shipSale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(screen.getAllByText(/DURGAPUR/).length).toBeGreaterThan(0)
  })

  it('hides the UDYAM row when empty or "-", shows it when set', () => {
    const { container, rerender } = render(<InvoiceTemplate sale={sale} allocations={allocs} settings={{ ...settings, seller_udyam: '' }} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).not.toContain('UDYAM')
    rerender(<InvoiceTemplate sale={sale} allocations={allocs} settings={{ ...settings, seller_udyam: '-' }} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).not.toContain('UDYAM')
    rerender(<InvoiceTemplate sale={sale} allocations={allocs} settings={{ ...settings, seller_udyam: 'UDYAM-WB-10-0066963' }} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('UDYAM-WB-10-0066963')
  })

  it('hides the Godown line when blank or same as office, shows it when different', () => {
    const diff = render(<InvoiceTemplate sale={sale} allocations={allocs} settings={{ ...settings, seller_address: 'Off Addr', seller_godown_address: 'Godown Addr' }} hsnDescriptions={hsnDescriptions} />)
    expect(diff.container.textContent).toContain('Godown:')
    diff.rerender(<InvoiceTemplate sale={sale} allocations={allocs} settings={{ ...settings, seller_address: 'Same Addr', seller_godown_address: 'Same Addr' }} hsnDescriptions={hsnDescriptions} />)
    expect(diff.container.textContent).not.toContain('Godown:')
    diff.rerender(<InvoiceTemplate sale={sale} allocations={allocs} settings={{ ...settings, seller_address: 'Off Addr', seller_godown_address: '' }} hsnDescriptions={hsnDescriptions} />)
    expect(diff.container.textContent).not.toContain('Godown:')
  })

  it('prints names/addresses in uniform uppercase regardless of stored casing', () => {
    const mixed = { ...sale, buyer_name: 'a r belt works', buyer_billing_json: '{"address":"12 mg road","city":"kolkata","state":"West Bengal","pincode":"700016"}' } as unknown as Sale
    const mixedSettings = { ...settings, seller_name: 'ramaxton plastocrafts', seller_email: 'Mix@Ed.com' } as Settings
    const { container } = render(<InvoiceTemplate sale={mixed} allocations={allocs} settings={mixedSettings} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('A R BELT WORKS')
    expect(container.textContent).toContain('12 MG ROAD')
    expect(container.textContent).toContain('RAMAXTON PLASTOCRAFTS')
    expect(container.textContent).not.toContain('a r belt works')
    // email is NOT uppercased
    expect(container.textContent).toContain('Mix@Ed.com')
  })

  it('uses CGST/SGST intra-state and IGST inter-state', () => {
    const { container, rerender } = render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('CGST')
    const inter = { ...sale, cgst: 0, sgst: 0, igst: 39661.2 } as unknown as Sale
    rerender(<InvoiceTemplate sale={inter} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('IGST')
    expect(container.textContent).not.toContain('CGST')
  })

  it('shows sale.place_of_supply_state as Place of Supply on both party blocks', () => {
    const { container } = render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    // Each copy has two party columns (Buyer + Consignee), so >=2 occurrences of "Place of Supply: WEST BENGAL"
    const matches = (container.textContent ?? '').match(/Place of Supply: WEST BENGAL/g)
    expect(matches).not.toBeNull()
    expect(matches!.length).toBeGreaterThanOrEqual(2)
  })

  it('falls back to billing state when place_of_supply_state is empty', () => {
    const noPos = { ...sale, place_of_supply_state: '' } as unknown as Sale
    const { container } = render(<InvoiceTemplate sale={noPos} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('Place of Supply: WEST BENGAL')
  })

  it('shows IGST when place_of_supply_state differs from home_state even with 0 igst', () => {
    const interNoTax = { ...sale, cgst: 0, sgst: 0, igst: 0, place_of_supply_state: 'Gujarat' } as unknown as Sale
    const { container } = render(<InvoiceTemplate sale={interNoTax} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('IGST')
    expect(container.textContent).not.toContain('CGST')
  })
})
