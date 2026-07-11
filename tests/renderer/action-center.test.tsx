// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import ActionCenter from '../../src/renderer/components/dashboard/ActionCenter'
import type { Sale, Purchase } from '../../src/shared/types'

const purchase = (o: Partial<Purchase> = {}) =>
  ({ id: 1, our_code: 'P1', party: 'Supp', invoice_date: '2026-06-01', total_invoice_amount: 500, payment_status: 'pending', ...o } as Purchase)
const sale = (o: Partial<Sale> = {}) =>
  ({ id: 7, invoice_number: 'RP/7', buyer_name: 'Acme', total_invoice_amount: 900, status: 'reserved', ...o } as Sale)

function setup(over: Partial<Parameters<typeof ActionCenter>[0]> = {}) {
  renderWithMantine(
    <HashRouter>
      <ActionCenter
        dueP={[purchase(), purchase({ id: 2, total_invoice_amount: 1500 })]}
        overdue={[{ sale: sale({ status: 'created' }), daysOld: 40 }]}
        reserved={[sale()]}
        lowMaterials={[{ hsn: '320419', kg: 250 }, { hsn: '39012000', kg: 400 }]}
        {...over}
      />
    </HashRouter>
  )
}

describe('ActionCenter', () => {
  it('summarises each group as a count and a headline, not a list of invoices', () => {
    setup()
    expect(screen.getByText('Money to collect')).toBeTruthy()
    expect(screen.getByText(/₹900.00 owed · oldest 40 days/)).toBeTruthy()
    expect(screen.getByText(/₹2,000.00 outstanding/)).toBeTruthy()   // 500 + 1500

    // the individual invoice numbers belong on the list screens, not here
    expect(screen.queryByText(/RP\/7 · Acme/)).toBeNull()
  })

  it('names the most urgent low material and counts the rest', () => {
    setup()
    expect(screen.getByText('320419 down to 250 kg (+1 more)')).toBeTruthy()
  })

  it('drops the "+n more" when only one material is low', () => {
    setup({ lowMaterials: [{ hsn: '320419', kg: 250 }] })
    expect(screen.getByText('320419 down to 250 kg')).toBeTruthy()
  })

  it('sends you to the unpaid invoices when you click money to collect', () => {
    setup()
    fireEvent.click(screen.getByText('Money to collect'))
    expect(window.location.hash).toBe('#/sales?unpaid=1')
  })

  it('sends you to the unpaid bills when you click bills to pay', () => {
    setup()
    fireEvent.click(screen.getByText('Bills to pay'))
    expect(window.location.hash).toBe('#/purchases?unpaid=1')
  })

  it('says there is nothing to do when a group is empty', () => {
    setup({ dueP: [], overdue: [], reserved: [], lowMaterials: [] })
    expect(screen.getAllByText('Nothing to do.').length).toBe(4)
  })
})
