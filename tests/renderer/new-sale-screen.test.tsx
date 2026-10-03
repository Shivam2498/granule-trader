// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import NewSale from '../../src/renderer/screens/NewSale'
import { SaleDraftProvider, useSaleDraft } from '../../src/renderer/sale-draft'
import type { AvailableLot, HsnProduct } from '../../src/shared/types'

const LOT: AvailableLot = {
  purchase_item_id: 1, purchase_id: 1, our_code: '0012/2526', party: 'Reliance',
  hsn_code: '39021000', description: 'PP Granules', invoice_date: '2026-01-12',
  rate_per_kg: 40, available_kg: 5000
}
const HSN: HsnProduct[] = [{ hsn_code: '39021000', description: 'PP Granules', gst_rate: 18 }]

// Adds a lot to the draft on click, the same way the real app does after navigating to "+ Choose
// lots" and back — a stand-in for that navigation so each test can seed a lot with known qty/rate.
function Harness({ id, qty, rate }: { id: number; qty: number; rate: number }) {
  const { addLots, setLot } = useSaleDraft()
  return <button onClick={() => { addLots([id]); setLot(id, { qty, rate }) }}>seed lot</button>
}

async function setup(qty: number, rate: number) {
  renderWithMantine(
    <HashRouter>
      <SaleDraftProvider>
        <Harness id={LOT.purchase_item_id} qty={qty} rate={rate} />
        <NewSale />
      </SaleDraftProvider>
    </HashRouter>
  )
  // Wait for the initial settings/customers/hsn/lots fetch to settle before seeding — the screen
  // resets the draft's lots to {} on first mount (see NewSale's "fresh" effect), so seeding any
  // earlier would just be wiped out once that fetch resolves.
  await waitFor(() => screen.getByText('+ Choose lots'))
  fireEvent.click(screen.getByText('seed lot'))
  return lotInputs('0012/2526')
}

// Returns the lots-table row's [rate, qty, amount] inputs, in column order.
async function lotInputs(code: string) {
  const row = (await screen.findByText(code)).closest('tr')!
  return within(row).getAllByRole('textbox') as HTMLInputElement[]
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getSettings: vi.fn().mockResolvedValue({ home_state: 'Gujarat', seller_name: 'RP Plastics', invoice_prefix: 'RP', default_gst_rate: 18 }),
    listCustomers: vi.fn().mockResolvedValue([]),
    listHsn: vi.fn().mockResolvedValue(HSN),
    listAvailableLots: vi.fn().mockResolvedValue([LOT]),
    nextInvoiceNumber: vi.fn().mockResolvedValue('RP/001/2526-27')
  }
})

describe('NewSale lots table — amount column', () => {
  it('typing amount recalculates rate, leaving qty untouched', async () => {
    const [rateInput, qtyInput, amountInput] = await setup(10, 50)
    expect(qtyInput.value).toBe('10')
    expect(rateInput.value).toBe('50')

    fireEvent.change(amountInput, { target: { value: '550' } })
    fireEvent.blur(amountInput)

    await waitFor(() => expect(rateInput.value).toBe('55'))
    expect(qtyInput.value).toBe('10')   // untouched by the amount edit
  })

  it('rounds the derived rate to 4 decimal places', async () => {
    const [rateInput, , amountInput] = await setup(3, 10.3333)

    fireEvent.change(amountInput, { target: { value: '32' } })
    fireEvent.blur(amountInput)

    // 32 / 3 = 10.6666... → rounds to 10.6667
    await waitFor(() => expect(rateInput.value).toBe('10.6667'))
  })

  it('amount typed while qty is 0 leaves rate unchanged; works once qty is set', async () => {
    const [rateInput, qtyInput, amountInput] = await setup(0, 0)
    expect(qtyInput.value).toBe('')    // MoneyInput blanks a zero qty
    expect(rateInput.value).toBe('')   // MoneyInput blanks a zero rate

    fireEvent.change(amountInput, { target: { value: '500' } })
    fireEvent.blur(amountInput)
    // Rate must stay whatever it was (still unset) — never derived from a qty of 0.
    expect(rateInput.value).toBe('')

    // Once qty is set, amount editing behaves normally again.
    fireEvent.change(qtyInput, { target: { value: '100' } })
    fireEvent.change(amountInput, { target: { value: '300' } })
    fireEvent.blur(amountInput)
    await waitFor(() => expect(rateInput.value).toBe('3'))
  })
})
