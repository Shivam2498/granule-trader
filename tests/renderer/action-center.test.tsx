// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import ActionCenter from '../../src/renderer/components/dashboard/ActionCenter'
import type { Sale, Purchase, LedgerRow } from '../../src/shared/types'

const p = (o: Partial<Purchase>) => ({ id: 1, our_code: 'P1', party: 'Supp', invoice_date: '2026-06-01', total_invoice_amount: 500, payment_status: 'pending' } as Purchase)
const s = (o: Partial<Sale>) => ({ id: 7, invoice_number: 'RP/7', buyer_name: 'Acme', total_invoice_amount: 900, status: 'reserved' } as Sale)
const l = (o: Partial<LedgerRow>) => ({ purchase_id: 1, our_code: 'L1', hsn_code: '3901', balance_kg: 100, ...o } as LedgerRow)

describe('ActionCenter', () => {
  it('shows counts and items for each action group', () => {
    renderWithMantine(
      <HashRouter>
        <ActionCenter
          dueP={[p({})]}
          overdue={[{ sale: { id: 7, invoice_number: 'RP/7', buyer_name: 'Acme', total_invoice_amount: 900 } as Sale, daysOld: 40 }]}
          reserved={[s({})]}
          lowLots={[l({ our_code: 'L1' })]}
        />
      </HashRouter>
    )
    expect(screen.getByText('Payables due (>2 days)')).toBeTruthy()
    expect(screen.getByText('Overdue receivables')).toBeTruthy()
    expect(screen.getByText('Reserved invoices')).toBeTruthy()
    expect(screen.getByText('Low stock')).toBeTruthy()
    expect(screen.getByText(/RP\/7.*Acme/)).toBeTruthy()   // overdue invoice number rendered
    expect(screen.getByText(/L1 /)).toBeTruthy()      // low-stock lot rendered
  })

  it('renders empty copy when a group has no items', () => {
    renderWithMantine(<HashRouter><ActionCenter dueP={[]} overdue={[]} reserved={[]} lowLots={[]} /></HashRouter>)
    expect(screen.getAllByText('Nothing here.').length).toBe(4)
  })
})
