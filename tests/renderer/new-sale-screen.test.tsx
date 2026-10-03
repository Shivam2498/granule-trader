// @vitest-environment jsdom
import { useState } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import NewSale from '../../src/renderer/screens/NewSale'
import { SaleDraftProvider, useSaleDraft } from '../../src/renderer/sale-draft'
import type { AvailableLot, Customer, HsnProduct } from '../../src/shared/types'

const LOT: AvailableLot = {
  purchase_item_id: 1, purchase_id: 1, our_code: '0012/2526', party: 'Reliance',
  hsn_code: '39021000', description: 'PP Granules', invoice_date: '2026-01-12',
  rate_per_kg: 40, available_kg: 5000
}
const HSN: HsnProduct[] = [{ hsn_code: '39021000', description: 'PP Granules', gst_rate: 18 }]
const CUSTOMER: Customer = {
  id: 1, name: 'Acme Corp', gstin: '27AABCU1234H1Z0', pan: 'AABCU1234H',
  phone: '9876543210', email: 'acme@example.com',
  billing_address: '123 Main St', billing_city: 'Delhi', billing_state: 'Delhi', billing_pincode: '110001',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

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

// Selects "Acme Corp" as the buyer via the Mantine Select, the same click-to-open /
// click-the-option pattern used elsewhere in this codebase for Mantine Select dropdowns.
// getAllByLabelText is needed (not getByLabelText) because Mantine's combobox listbox is
// also aria-labelledby the "Buyer" label even while closed, so the plain query matches two
// elements; the input is always the first in document order.
async function selectBuyer() {
  await waitFor(() => screen.getByText('+ Choose lots'))
  const [buyerInput] = screen.getAllByLabelText('Buyer')
  fireEvent.click(buyerInput)
  fireEvent.click(await screen.findByText(/Acme Corp/))
}

describe('NewSale — inline customer edit', () => {
  beforeEach(() => {
    ;(window as unknown as { api: { listCustomers: () => Promise<Customer[]>; updateCustomer: (...a: unknown[]) => Promise<Customer> } }).api.listCustomers = vi.fn().mockResolvedValue([CUSTOMER])
    // The GSTIN is one of the fields actually rendered in the buyer info block, so changing it
    // (rather than phone, which isn't shown there) lets tests prove the block re-renders with
    // fresh data from onSaved, not just that the screen didn't navigate away.
    ;(window as unknown as { api: { updateCustomer: (...a: unknown[]) => Promise<Customer> } }).api.updateCustomer = vi.fn().mockResolvedValue({ ...CUSTOMER, gstin: '29AAAAA0000A1Z5' })
  })

  // Includes the same lot-seeding Harness used by the "amount column" tests above, so the
  // draft-survival test can seed a chosen lot before touching the customer-edit flow.
  function renderScreen() {
    renderWithMantine(
      <HashRouter>
        <SaleDraftProvider>
          <Harness id={LOT.purchase_item_id} qty={10} rate={50} />
          <NewSale />
        </SaleDraftProvider>
      </HashRouter>
    )
  }

  it('shows no Edit button before a buyer is selected', async () => {
    renderScreen()
    await waitFor(() => screen.getByText('+ Choose lots'))
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBe(null)
  })

  it('shows Edit button next to buyer info after selecting a buyer', async () => {
    renderScreen()
    await selectBuyer()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeTruthy()
  })

  it('opens the customer edit modal, seeded with the selected buyer, when Edit is clicked', async () => {
    renderScreen()
    await selectBuyer()

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect((screen.getByLabelText(/^gstin/i) as HTMLInputElement).value).toBe('27AABCU1234H1Z0')
  })

  it('updates the buyer info block in place when the customer is saved, without navigating away', async () => {
    renderScreen()
    await selectBuyer()

    // Before the edit, the info block shows the buyer's original GSTIN.
    expect(screen.getByText('27AABCU1234H1Z0')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    // Scoped to the modal — NewSale's own "Save" button also matches this name.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^save$/i }))

    // Modal closes once the save resolves.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBe(null))

    // Still on the New sale screen — no navigation away.
    expect(screen.getAllByLabelText('Buyer')[0]).toBeTruthy()

    // The info block now shows the fresh GSTIN returned by updateCustomer (via onSaved →
    // setCustomers), proving the block actually re-rendered with the new data — not merely that
    // the screen stayed put.
    expect(screen.getByText('29AAAAA0000A1Z5')).toBeTruthy()
    expect(screen.queryByText('27AABCU1234H1Z0')).toBe(null)
  })

  it('leaves the in-progress draft (chosen lot, invoice number) untouched by the edit flow', async () => {
    renderScreen()
    await waitFor(() => screen.getByText('+ Choose lots'))
    fireEvent.click(screen.getByText('seed lot'))
    await screen.findByText('0012/2526')

    const invoiceNumberBefore = (screen.getByLabelText('Invoice number') as HTMLInputElement).value
    const [, qtyInputBefore] = await lotInputs('0012/2526')
    expect(qtyInputBefore.value).toBe('10')

    await selectBuyer()
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    // Change a field inside the modal and save — this must not touch the sale draft at all.
    const phoneInput = within(screen.getByRole('dialog')).getByLabelText(/^phone/i)
    fireEvent.change(phoneInput, { target: { value: '1111111111' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBe(null))

    // The chosen lot is still there with its original qty/rate, and the invoice number is unchanged.
    const [rateInputAfter, qtyInputAfter] = await lotInputs('0012/2526')
    expect(qtyInputAfter.value).toBe('10')
    expect(rateInputAfter.value).toBe('50')
    expect((screen.getByLabelText('Invoice number') as HTMLInputElement).value).toBe(invoiceNumberBefore)
  })
})

describe('NewSale — chosen lot not in stock on the invoice date', () => {
  const EARLY: AvailableLot = { ...LOT, purchase_item_id: 1, our_code: 'LOT-A', invoice_date: '2026-09-01' }
  const LATE: AvailableLot = { ...LOT, purchase_item_id: 2, our_code: 'LOT-B', invoice_date: '2026-09-20' }
  const BUYER: Customer = { ...CUSTOMER, billing_state: 'Gujarat' }

  // Seeds both lots plus a buyer/vehicle, and offers the same date change LotSelect's
  // "Available on" field makes — moving the invoice date before LOT-B was bought.
  function Seeder() {
    const { addLots, setLot, patch } = useSaleDraft()
    return <>
      <button onClick={() => {
        addLots([1, 2]); setLot(1, { qty: 10, rate: 50 }); setLot(2, { qty: 10, rate: 50 })
        patch({ buyerId: 1, vehicle: 'GJ-05' })
      }}>seed both</button>
      <button onClick={() => patch({ invoiceDate: '2026-09-10' })}>move date earlier</button>
    </>
  }

  it('flags the lot, blocks Save, and lets you remove it instead of silently dropping it', async () => {
    const createSale = vi.fn().mockResolvedValue({ id: 9 })
    ;(window as unknown as { api: unknown }).api = {
      getSettings: vi.fn().mockResolvedValue({ home_state: 'Gujarat', invoice_prefix: 'RP', default_gst_rate: 18 }),
      listCustomers: vi.fn().mockResolvedValue([BUYER]),
      listHsn: vi.fn().mockResolvedValue(HSN),
      listAvailableLots: vi.fn().mockImplementation((d: string) => Promise.resolve(d < '2026-09-20' ? [EARLY] : [EARLY, LATE])),
      nextInvoiceNumber: vi.fn().mockResolvedValue('RP/001'),
      createSale
    }
    renderWithMantine(<HashRouter><SaleDraftProvider><Seeder /><NewSale /></SaleDraftProvider></HashRouter>)
    await waitFor(() => screen.getByText('+ Choose lots'))
    fireEvent.click(screen.getByText('seed both'))
    await screen.findByText('LOT-B')

    fireEvent.click(screen.getByText('move date earlier'))

    await screen.findByText(/1 chosen lot isn't in stock on 10\/09\/2026/)
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement
    expect(save.disabled).toBe(true)

    fireEvent.click(screen.getByRole('button', { name: /remove it/i }))
    await waitFor(() => expect(screen.queryByText(/isn't in stock/)).toBe(null))
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false))

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(createSale).toHaveBeenCalled())
    expect(createSale.mock.calls[0][0].lines.map((l: { purchase_item_id: number }) => l.purchase_item_id)).toEqual([1])
  })

  it('does not flag lots while availability is still loading after returning from Choose lots', async () => {
    let pending = false
    let resolvePending: (v: AvailableLot[]) => void = () => {}
    ;(window as unknown as { api: unknown }).api = {
      getSettings: vi.fn().mockResolvedValue({ home_state: 'Gujarat', invoice_prefix: 'RP', default_gst_rate: 18 }),
      listCustomers: vi.fn().mockResolvedValue([BUYER]),
      listHsn: vi.fn().mockResolvedValue(HSN),
      listAvailableLots: vi.fn().mockImplementation(() =>
        pending ? new Promise(r => { resolvePending = r }) : Promise.resolve([EARLY, LATE])),
      nextInvoiceNumber: vi.fn().mockResolvedValue('RP/001')
    }
    // NewSale unmounts while the user is on the Choose-lots page; the draft (context) survives.
    function Shell() {
      const [shown, setShown] = useState(true)
      return <>
        <Seeder />
        <button onClick={() => setShown(s => !s)}>toggle screen</button>
        {shown && <NewSale />}
      </>
    }
    renderWithMantine(<HashRouter><SaleDraftProvider><Shell /></SaleDraftProvider></HashRouter>)
    await waitFor(() => screen.getByText('+ Choose lots'))
    fireEvent.click(screen.getByText('seed both'))
    await screen.findByText('LOT-B')

    fireEvent.click(screen.getByText('toggle screen'))
    pending = true
    fireEvent.click(screen.getByText('toggle screen'))
    await waitFor(() => screen.getByText('+ Choose lots'))
    expect(screen.queryByText(/in stock on/)).toBe(null)
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)

    resolvePending([EARLY, LATE])
    await screen.findByText('LOT-B')
    expect(screen.queryByText(/in stock on/)).toBe(null)
  })
})
