// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { theme } from '../../src/renderer/theme'
import Outstanding from '../../src/renderer/screens/Outstanding'
import './mantine'

const sales = [
  { id: 1, status: 'created', invoice_date: '2026-07-10', buyer_customer_id: 7, buyer_name: 'Jenisa',
    payment_status: 'pending', total_invoice_amount: 5900, total_qty_kg: 50, amount: 5000, cgst: 450, sgst: 450, igst: 0 },
  { id: 2, status: 'created', invoice_date: '2026-05-10', buyer_customer_id: 9, buyer_name: 'Acme',
    payment_status: 'pending', total_invoice_amount: 12000, total_qty_kg: 100, amount: 10000, cgst: 1000, sgst: 1000, igst: 0 },
  { id: 3, status: 'created', invoice_date: '2026-07-01', buyer_customer_id: 5, buyer_name: 'Paid',
    payment_status: 'done', total_invoice_amount: 999, total_qty_kg: 1, amount: 1, cgst: 0, sgst: 0, igst: 0 },
]

beforeEach(() => {
  ;(window as any).api = {
    listSales: vi.fn().mockResolvedValue(sales),
    listPurchases: vi.fn().mockResolvedValue([]),
    getSettings: vi.fn().mockResolvedValue({ seller_name: 'Ramaxton' }),
    exportCsv: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/x.csv' }),
  }
  vi.setSystemTime(new Date('2026-07-19T00:00:00Z'))
})

function mount() {
  return render(
    <MantineProvider theme={theme} forceColorScheme="light">
      <MemoryRouter initialEntries={['/outstanding']}>
        <Routes>
          <Route path="/outstanding" element={<Outstanding />} />
          <Route path="/reports" element={<div>reports:{location.hash}</div>} />
        </Routes>
      </MemoryRouter>
    </MantineProvider>
  )
}

describe('Outstanding screen', () => {
  it('lists receivable parties, aged, largest first, with a total', async () => {
    mount()
    expect(await screen.findByText('Acme')).toBeTruthy()
    const rows = screen.getAllByText(/Acme|Jenisa/).map(el => el.closest('tr')!)
    // Acme (12000) sorts before Jenisa (5900)
    expect(within(rows[0]).getByText('Acme')).toBeTruthy()
    // Acme's 12000 is 70 days old → shown in both the 60+ and Total cells of its row
    expect(within(rows[0]).getAllByText('₹12,000.00').length).toBe(2)
    expect(screen.getAllByText('₹17,900.00').length).toBe(2)  // header + TOTAL row (5900 + 12000)
    expect(screen.queryByText('Paid')).toBeNull()          // settled invoice excluded
  })

  it('shows the empty state for payables', async () => {
    mount()
    expect(await screen.findByText('Nothing outstanding. All settled.')).toBeTruthy()
  })

  it('downloads a receivables CSV ending in a TOTAL row', async () => {
    mount()
    await screen.findByText('Acme')
    fireEvent.click(screen.getAllByRole('button', { name: /csv/i })[0])
    await waitFor(() => expect((window as any).api.exportCsv).toHaveBeenCalled())
    const [name, content] = (window as any).api.exportCsv.mock.calls[0]
    expect(name).toMatch(/^Receivables-outstanding-2026-07-19\.csv$/)
    expect(content.trim().split('\n').at(-1)).toContain('TOTAL')
    expect(content).toContain('17900')
  })
})
