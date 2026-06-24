// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InvoiceTemplate from '../../src/renderer/invoice/InvoiceTemplate'
import type { Sale, SaleAllocation, Settings } from '@shared/types'

const settings = { seller_name: 'RP Plastics', seller_address: 'Surat', seller_gstin: '24AAA', seller_pan: 'AAA', home_state: 'Gujarat', invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10 } as Settings
const sale = { id: 1, invoice_number: 'RP/008/2024-25', invoice_date: '2024-05-10', buyer_name: 'Beta', buyer_gstin: '24BBB', buyer_billing_json: '{"city":"Rajkot"}', buyer_shipping_json: '{}', hsn_code: '3902', amount: 84000, cgst: 7560, sgst: 7560, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 99120, total_qty_kg: 1000, vehicle: 'By Van', eway_bill_no: null, eway_bill_date: null } as unknown as Sale
const allocs = [{ id: 1, sale_id: 1, purchase_id: 1, qty_drawn_kg: 1000, rate_per_kg: 84, line_amount: 84000 }] as SaleAllocation[]

describe('InvoiceTemplate', () => {
  it('renders seller, buyer, invoice number, and total', () => {
    render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} />)
    expect(screen.getByText('RP Plastics')).toBeTruthy()
    expect(screen.getByText(/RP\/008\/2024-25/)).toBeTruthy()
    expect(screen.getByText(/Beta/)).toBeTruthy()
    expect(screen.getByText(/99,120\.00/)).toBeTruthy()
  })

  it('renders IGST for an inter-state sale and hides CGST/SGST', () => {
    const interSale = { ...sale, cgst: 0, sgst: 0, igst: 15120, total_invoice_amount: 99120 } as unknown as Sale
    const { container } = render(<InvoiceTemplate sale={interSale} allocations={allocs} settings={settings} />)
    expect(screen.getByText('IGST')).toBeTruthy()
    // Check that CGST and SGST labels do not appear in the document
    const cgstMatch = container.textContent?.includes('CGST')
    const sgstMatch = container.textContent?.includes('SGST')
    expect(cgstMatch).toBeFalsy()
    expect(sgstMatch).toBeFalsy()
  })
})
