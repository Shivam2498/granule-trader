// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import PurchaseForm from '../../src/renderer/screens/PurchaseForm'
import type { HsnProduct } from '../../src/shared/types'

const HSN: HsnProduct[] = [{ hsn_code: '39021000', description: 'PP Granules', gst_rate: 18 }]

async function setup() {
  renderWithMantine(<HashRouter><PurchaseForm /></HashRouter>)
  // Wait for the initial settings/hsn/suppliers fetch to settle — the screen shows "Loading…"
  // until then, and the items table (with its one blank row) only exists after.
  await waitFor(() => screen.getByText('Items'))
  const row = document.querySelector('tbody tr') as HTMLElement
  const cells = row.querySelectorAll('td')
  // Column order per PurchaseForm's items table: HSN, Description, Qty, Rate, Amount, remove.
  return {
    qtyInput: cells[2].querySelector('input') as HTMLInputElement,
    rateInput: cells[3].querySelector('input') as HTMLInputElement,
    amountInput: cells[4].querySelector('input') as HTMLInputElement
  }
}

beforeEach(() => {
  ;(window as unknown as { api: unknown }).api = {
    getSettings: vi.fn().mockResolvedValue({ home_state: 'Gujarat', seller_name: 'RP Plastics', invoice_prefix: 'RP', default_gst_rate: 18 }),
    listHsn: vi.fn().mockResolvedValue(HSN),
    listSuppliers: vi.fn().mockResolvedValue([]),
    listPurchases: vi.fn().mockResolvedValue([]),
    getPurchaseItems: vi.fn().mockResolvedValue([]),
    nextPurchaseCode: vi.fn().mockResolvedValue('0001/2627')
  }
})

describe('PurchaseForm items table — amount column', () => {
  it('typing amount recalculates rate, leaving qty untouched', async () => {
    const { qtyInput, rateInput, amountInput } = await setup()

    fireEvent.change(qtyInput, { target: { value: '10' } })
    fireEvent.change(rateInput, { target: { value: '50' } })
    expect(qtyInput.value).toBe('10')
    expect(rateInput.value).toBe('50')

    fireEvent.change(amountInput, { target: { value: '550' } })
    fireEvent.blur(amountInput)

    await waitFor(() => expect(rateInput.value).toBe('55'))
    expect(qtyInput.value).toBe('10')   // untouched by the amount edit
  })

  it('rounds the derived rate to 4 decimal places', async () => {
    const { qtyInput, rateInput, amountInput } = await setup()

    fireEvent.change(qtyInput, { target: { value: '3' } })
    fireEvent.change(rateInput, { target: { value: '10.3333' } })

    fireEvent.change(amountInput, { target: { value: '32' } })
    fireEvent.blur(amountInput)

    // 32 / 3 = 10.6666... → rounds to 10.6667
    await waitFor(() => expect(rateInput.value).toBe('10.6667'))
  })

  it('amount typed while qty is 0 leaves rate unchanged; works once qty is set', async () => {
    const { qtyInput, rateInput, amountInput } = await setup()
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
