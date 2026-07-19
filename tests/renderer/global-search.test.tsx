// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { theme } from '../../src/renderer/theme'
import GlobalSearch from '../../src/renderer/components/GlobalSearch'
import './mantine'

function Probe() { const l = useLocation(); return <div data-testid="loc">{l.pathname}</div> }

beforeEach(() => {
  ;(window as any).api = {
    listSales: vi.fn().mockResolvedValue([
      { id: 1, status: 'created', invoice_number: 'RP/039/2026-27', buyer_name: 'Jenisa Enterprise', buyer_gstin: '19X', total_invoice_amount: 18499.99 },
    ]),
    listPurchases: vi.fn().mockResolvedValue([]),
    listCustomers: vi.fn().mockResolvedValue([
      { id: 7, name: 'Jenisa Enterprise', gstin: '19X', phone: '', email: '', billing_city: 'Kolkata' },
    ]),
    listSuppliers: vi.fn().mockResolvedValue([]),
    stockLedger: vi.fn().mockResolvedValue([]),
  }
})

function mount() {
  return render(
    <MantineProvider theme={theme} forceColorScheme="light">
      <MemoryRouter initialEntries={['/']}>
        <GlobalSearch />
        <Routes><Route path="*" element={<Probe />} /></Routes>
      </MemoryRouter>
    </MantineProvider>
  )
}

describe('GlobalSearch', () => {
  it('shows grouped results as you type and opens a record on Enter', async () => {
    mount()
    const box = screen.getByLabelText('Global search')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'jenisa' } })
    expect(await screen.findByText('Invoices')).toBeTruthy()
    expect(screen.getByText('Customers')).toBeTruthy()
    expect(screen.getByText('RP/039/2026-27')).toBeTruthy()
    fireEvent.keyDown(box, { key: 'Enter' })   // first flat hit = the invoice
    await waitFor(() => expect(screen.getByTestId('loc').textContent).toBe('/invoice/1'))
  })

  it('shows nothing for a one-character query', async () => {
    mount()
    const box = screen.getByLabelText('Global search')
    fireEvent.focus(box)
    fireEvent.change(box, { target: { value: 'j' } })
    await waitFor(() => expect((window as any).api.listCustomers).toHaveBeenCalled())
    expect(screen.queryByText('Customers')).toBeNull()
  })
})
