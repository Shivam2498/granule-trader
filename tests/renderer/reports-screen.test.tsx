// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { theme } from '../../src/renderer/theme'
import { FYProvider } from '../../src/renderer/fy'
import Reports from '../../src/renderer/screens/Reports'
import './mantine'   // jsdom matchMedia / ResizeObserver stubs

const sales = [
  { id: 1, invoice_number: 'RP/001/2026-27', seq: 1, status: 'created', invoice_date: '2026-04-02',
    buyer_customer_id: 7, buyer_name: 'Jenisa Enterprise', buyer_gstin: 'X', buyer_billing_json: '{}',
    total_qty_kg: 100, amount: 15678.25, cgst: 1411.04, sgst: 1411.04, igst: 0, tcs: 0, roundoff: -0.34,
    total_invoice_amount: 18499.99, payment_status: 'done', payment_date: '2026-04-02' },
  { id: 2, invoice_number: 'RP/015/2026-27', seq: 15, status: 'created', invoice_date: '2026-05-25',
    buyer_customer_id: 7, buyer_name: 'Jenisa Enterprise', buyer_gstin: 'X', buyer_billing_json: '{}',
    total_qty_kg: 50, amount: 5000, cgst: 450, sgst: 450, igst: 0, tcs: 0, roundoff: 0,
    total_invoice_amount: 5900, payment_status: 'pending', payment_date: null }
]

beforeEach(() => {
  ;(window as any).api = {
    listSales: vi.fn().mockResolvedValue(sales),
    listPurchases: vi.fn().mockResolvedValue([]),
    listCustomers: vi.fn().mockResolvedValue([{ id: 7, name: 'Jenisa Enterprise', gstin: 'X' }]),
    listSuppliers: vi.fn().mockResolvedValue([]),
    listFinancialYears: vi.fn().mockResolvedValue(['2026-27']),
    getSettings: vi.fn().mockResolvedValue({ seller_name: 'Ramaxton', invoice_prefix: 'RP' }),
    exportCsv: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/x.csv' })
  }
})

function mount(url = '/reports?type=sales&party=7') {
  return render(
    <MantineProvider theme={theme} forceColorScheme="light">
      <MemoryRouter initialEntries={[url]}><FYProvider><Reports /></FYProvider></MemoryRouter>
    </MantineProvider>
  )
}

describe('Reports screen', () => {
  it('prefills from query params and lists the party’s invoices with totals', async () => {
    mount()
    expect(await screen.findByText('RP/001/2026-27')).toBeTruthy()
    expect(screen.getByText('RP/015/2026-27')).toBeTruthy()
    const totals = screen.getByTestId('report-totals')
    expect(within(totals).getByText('150 kg')).toBeTruthy()
    expect(within(totals).getByText('₹24,399.99')).toBeTruthy()   // 18499.99 + 5900
    expect(screen.getByText(/Sales Statement — Jenisa Enterprise — 2026-27/)).toBeTruthy()
  })

  it('unpaid-only filter keeps just the pending invoice', async () => {
    mount()
    await screen.findByText('RP/001/2026-27')
    fireEvent.click(screen.getByRole('radio', { name: /unpaid only/i }))
    await waitFor(() => expect(screen.queryByText('RP/001/2026-27')).toBeNull())
    expect(screen.getByText('RP/015/2026-27')).toBeTruthy()
    expect(screen.getByText(/unpaid only/)).toBeTruthy()
  })

  it('downloads a CSV named for the party, ending in a TOTAL row', async () => {
    mount()
    await screen.findByText('RP/001/2026-27')
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect((window as any).api.exportCsv).toHaveBeenCalled())
    const [name, content] = (window as any).api.exportCsv.mock.calls[0]
    expect(name).toBe('Sales-Jenisa-Enterprise-2026-27.csv')
    expect(content).toContain('RP/001/2026-27')
    const lastLine = content.trim().split('\n').at(-1)
    expect(lastLine).toContain('TOTAL')
    expect(lastLine).toContain('24399.99')
  })
})
