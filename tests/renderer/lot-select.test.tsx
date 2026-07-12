// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, within, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import LotSelect from '../../src/renderer/screens/LotSelect'
import { SaleDraftProvider, useSaleDraft, emptyDraft, type SaleDraft } from '../../src/renderer/sale-draft'
import type { AvailableLot, HsnProduct } from '../../src/shared/types'

const lot = (o: Partial<AvailableLot> & { purchase_item_id: number }): AvailableLot => ({
  purchase_id: 1, our_code: `00${o.purchase_item_id}/2526`, party: 'Reliance', hsn_code: '39021000',
  description: 'PP Granules', invoice_date: '2026-01-12', rate_per_kg: 80, available_kg: 5000, ...o
})

const LOTS = [
  lot({ purchase_item_id: 1, our_code: '0012/2526', available_kg: 5000 }),
  lot({ purchase_item_id: 2, our_code: '0015/2526', available_kg: 4000 }),
  lot({ purchase_item_id: 3, our_code: '0021/2526', hsn_code: '39012000', description: 'HDPE', available_kg: 900 })
]
const HSN: HsnProduct[] = [
  { hsn_code: '39021000', description: 'PP Granules', gst_rate: 18 },
  { hsn_code: '39012000', description: 'HDPE', gst_rate: 18 }
]

// Exposes the draft so a test can assert what "Add lots" actually put on the sale.
let seen: SaleDraft
function Probe() {
  const { draft } = useSaleDraft()
  seen = draft
  return null
}

function setup(initial?: Partial<SaleDraft>) {
  const start: SaleDraft = { ...emptyDraft('new'), invoiceDate: '2026-07-12', ...initial }
  function Seed() {
    const { draft, reset } = useSaleDraft()
    if (draft.key !== start.key || Object.keys(draft.lots).length !== Object.keys(start.lots).length) {
      // seed once, before the page reads it
      if (draft.key === 'none') reset(start)
    }
    return null
  }
  renderWithMantine(
    <HashRouter>
      <SaleDraftProvider>
        <Seed />
        <Probe />
        <LotSelect />
      </SaleDraftProvider>
    </HashRouter>
  )
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    listHsn: vi.fn().mockResolvedValue(HSN),
    listAvailableLots: vi.fn().mockResolvedValue(LOTS)
  }
})

describe('LotSelect page', () => {
  it('shows every available lot', async () => {
    setup()
    expect(await screen.findByText('0012/2526')).toBeTruthy()
    expect(screen.getByText('0015/2526')).toBeTruthy()
    expect(screen.getByText('0021/2526')).toBeTruthy()
    expect(screen.getByText(/Showing 3 of 3 lots · 9900 kg/)).toBeTruthy()
  })

  it('filters the lots by HSN', async () => {
    setup()
    await screen.findByText('0012/2526')
    // pick the HDPE material from the HSN dropdown
    fireEvent.click(screen.getByRole('textbox', { name: /Material \(HSN\)/i }))
    fireEvent.click(await screen.findByText(/39012000 · HDPE/))

    await waitFor(() => expect(screen.getByText(/Showing 1 of 3 lots · 900 kg/)).toBeTruthy())
    expect(screen.getByText('0021/2526')).toBeTruthy()
    expect(screen.queryByText('0012/2526')).toBeNull()
  })

  it('searches by lot code', async () => {
    setup()
    await screen.findByText('0012/2526')
    fireEvent.change(screen.getByLabelText(/Search/i), { target: { value: '0015' } })
    await waitFor(() => expect(screen.getByText(/Showing 1 of 3 lots/)).toBeTruthy())
    expect(screen.getByText('0015/2526')).toBeTruthy()
  })

  it('ticks lots and adds them to the sale', async () => {
    setup()
    await screen.findByText('0012/2526')
    fireEvent.click(screen.getByLabelText('Select 0012/2526'))
    fireEvent.click(screen.getByLabelText('Select 0021/2526'))

    expect(screen.getByRole('button', { name: /Add 2 lots/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Add 2 lots/ }))

    await waitFor(() => expect(Object.keys(seen.lots).map(Number).sort()).toEqual([1, 3]))
    expect(seen.lots[1]).toEqual({ qty: 0, rate: 0 })
  })

  it('cannot add before anything is ticked', async () => {
    setup()
    await screen.findByText('0012/2526')
    expect((screen.getByRole('button', { name: /Add lots/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('marks lots already on the sale, and will not let them be added twice', async () => {
    setup({ lots: { 1: { qty: 100, rate: 90 } } })
    await screen.findByText('0012/2526')
    const row = screen.getByText('0012/2526').closest('tr')!
    expect(within(row).getByText('added')).toBeTruthy()
    expect((within(row).getByLabelText('Select 0012/2526') as HTMLInputElement).disabled).toBe(true)
  })

  it('select-all ticks every visible lot', async () => {
    setup()
    await screen.findByText('0012/2526')
    fireEvent.click(screen.getByLabelText('Select all'))
    expect(screen.getByRole('button', { name: /Add 3 lots/ })).toBeTruthy()
  })
})
