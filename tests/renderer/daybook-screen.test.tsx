// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// The title is "<seller> · Day Book — <date>" split across text nodes; match on the whole element.
const titled = (text: string) => (_: string, el: Element | null) =>
  el?.tagName.toLowerCase().startsWith('h') === true && (el.textContent ?? '').includes(text)
import { MantineProvider } from '@mantine/core'
import { theme } from '../../src/renderer/theme'
import Daybook from '../../src/renderer/screens/Daybook'
import './mantine'

const sales = [
  { id: 1, status: 'created', invoice_number: 'RP/050', invoice_date: '2026-07-19', buyer_name: 'Jenisa', total_invoice_amount: 5900, payment_status: 'pending', payment_date: null },
  { id: 2, status: 'created', invoice_number: 'RP/049', invoice_date: '2026-07-18', buyer_name: 'Acme', total_invoice_amount: 999, payment_status: 'pending', payment_date: null },
]
const purchases = [
  { id: 10, our_code: '040/2627', invoice_date: '2026-07-19', party: 'Swastik', total_invoice_amount: 14160, payment_status: 'pending', payment_date: null },
]

beforeEach(() => {
  vi.setSystemTime(new Date('2026-07-19T09:00:00Z'))
  ;(window as any).api = {
    listSales: vi.fn().mockResolvedValue(sales),
    listPurchases: vi.fn().mockResolvedValue(purchases),
    getSettings: vi.fn().mockResolvedValue({ seller_name: 'Ramaxton' }),
    exportCsv: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/x.csv' }),
  }
})

function mount() {
  return render(
    <MantineProvider theme={theme} forceColorScheme="light"><Daybook /></MantineProvider>
  )
}

describe('Daybook screen', () => {
  it("shows today's sales and purchases, and flips to the previous day", async () => {
    mount()
    expect(await screen.findByText('RP/050')).toBeTruthy()      // invoiced 19th
    expect(screen.getByText('040/2627')).toBeTruthy()           // purchase 19th
    expect(screen.queryByText('RP/049')).toBeNull()             // that was the 18th
    expect(screen.getByText(titled('Day Book — 19/07/2026'))).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /prev day/i }))
    expect(await screen.findByText(titled('Day Book — 18/07/2026'))).toBeTruthy()
    expect(screen.getByText('RP/049')).toBeTruthy()
    expect(screen.queryByText('RP/050')).toBeNull()
  })

  it('downloads a CSV named for the day', async () => {
    mount()
    await screen.findByText('RP/050')
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect((window as any).api.exportCsv).toHaveBeenCalled())
    const [name, content] = (window as any).api.exportCsv.mock.calls[0]
    expect(name).toBe('Daybook-2026-07-19.csv')
    expect(content).toContain('SALES INVOICED')
    expect(content).toContain('RP/050')
    expect(content).toContain('NET IN TODAY')
  })
})
