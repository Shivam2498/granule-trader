// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { openDatabase } from '../../src/main/db/connection'
import { saveSettings, getSettings } from '../../src/main/core/reference'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { createSale, getSale, getAllocations } from '../../src/main/core/sale'
import InvoiceTemplate from '../../src/renderer/invoice/InvoiceTemplate'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:'); saveSettings(db, { home_state: 'Gujarat', seller_name: 'RP Plastics', invoice_prefix: 'RP' }) })

describe('sale → stock → invoice', () => {
  it('decrements stock and renders an invoice total', () => {
    const lot = createPurchase(db, { our_code: '0001/2425', supplier_invoice_number: 'S1', invoice_date: '2024-05-01',
      party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', qty_kg: 1000, amount: 50000, gst_rate: 18, homeState: 'Gujarat' })

    const sale = createSale(db, { invoice_number: 'RP/008/2024-25', invoice_date: '2024-05-10',
      buyer_customer_id: null, buyer_name: 'Beta', buyer_gstin: '24BBB',
      buyer_billing: { city: 'Rajkot', state: 'Gujarat' }, buyer_shipping: { city: 'Rajkot', state: 'Gujarat' },
      place_of_supply_state: 'Gujarat', homeState: 'Gujarat', hsn_code: '3902', gst_rate: 18,
      lines: [{ purchase_id: lot.id, qty_drawn_kg: 1000, rate_per_kg: 84 }] })

    expect(getPurchase(db, lot.id)!.qty_remaining_kg).toBe(0)
    expect(sale.amount).toBe(84000)
    expect(sale.total_invoice_amount).toBe(99120)   // 84000 + 7560 + 7560

    render(<InvoiceTemplate sale={getSale(db, sale.id)} allocations={getAllocations(db, sale.id)} settings={getSettings(db)} />)
    expect(screen.getByText(/RP\/008\/2024-25/)).toBeTruthy()
    expect(screen.getByText(/99,120\.00/)).toBeTruthy()
  })
})
