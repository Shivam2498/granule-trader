// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import PurchaseForm from '../../src/renderer/screens/PurchaseForm'
import type { HsnProduct, Supplier } from '../../src/shared/types'

const HSN: HsnProduct[] = [{ hsn_code: '39021000', description: 'PP Granules', gst_rate: 18 }]
const SUPPLIER: Supplier = {
  id: 1, name: 'Widget Inc', gstin: '27AABCU1234H1Z1', pan: 'AABCU1234H',
  phone: '9876543210', email: 'widgets@example.com',
  address: '456 Oak Ave', city: 'Mumbai', state: 'Maharashtra', pincode: '400001'
}

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

// Selects "Widget Inc" as the supplier via the Mantine Select, the same click-to-open /
// click-the-option pattern used elsewhere in this codebase for Mantine Select dropdowns.
// getAllByLabelText is needed (not getByLabelText) because Mantine's combobox listbox is
// also aria-labelledby the "Supplier" label even while closed, so the plain query matches two
// elements; the input is always the first in document order.
async function selectSupplier() {
  await waitFor(() => screen.getByText('Items'))
  // The label's accessible text is "Supplier *" (withAsterisk adds a literal " *" text node), and
  // a plain "Supplier" substring match would also catch the "Supplier invoice no." field above it.
  const [supplierInput] = screen.getAllByLabelText(/^Supplier\s*\*?$/)
  fireEvent.click(supplierInput)
  fireEvent.click(await screen.findByText(/Widget Inc/))
}

// Returns the single item row's [hsn select wrapper, qty, rate] inputs, re-queried fresh so a
// stale reference from before a modal interaction can't hide a DOM remount.
function itemRowInputs() {
  const row = document.querySelector('tbody tr') as HTMLElement
  const cells = row.querySelectorAll('td')
  return {
    qtyInput: cells[2].querySelector('input') as HTMLInputElement,
    rateInput: cells[3].querySelector('input') as HTMLInputElement
  }
}

describe('PurchaseForm — inline supplier edit', () => {
  beforeEach(() => {
    ;(window as unknown as { api: { listSuppliers: () => Promise<Supplier[]>; updateSupplier: (...a: unknown[]) => Promise<Supplier> } }).api.listSuppliers = vi.fn().mockResolvedValue([SUPPLIER])
    // The GSTIN is one of the fields actually rendered in the supplier info block, so changing
    // it (rather than phone, which isn't shown there) lets tests prove the block re-renders with
    // fresh data from onSaved, not just that the screen didn't navigate away.
    ;(window as unknown as { api: { updateSupplier: (...a: unknown[]) => Promise<Supplier> } }).api.updateSupplier = vi.fn().mockResolvedValue({ ...SUPPLIER, gstin: '29AAAAA0000A1Z5' })
  })

  function renderScreen() {
    renderWithMantine(<HashRouter><PurchaseForm /></HashRouter>)
  }

  it('shows no Edit button before a supplier is selected', async () => {
    renderScreen()
    await waitFor(() => screen.getByText('Items'))
    expect(screen.queryByRole('button', { name: /^edit$/i })).toBe(null)
  })

  it('shows Edit button next to supplier info after selecting a supplier', async () => {
    renderScreen()
    await selectSupplier()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeTruthy()
  })

  it('opens the supplier edit modal, seeded with the selected supplier, when Edit is clicked', async () => {
    renderScreen()
    await selectSupplier()

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))

    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())
    expect((screen.getByLabelText(/^gstin/i) as HTMLInputElement).value).toBe('27AABCU1234H1Z1')
  })

  it('updates the supplier info block in place when the supplier is saved, without navigating away', async () => {
    renderScreen()
    await selectSupplier()

    // Before the edit, the info block shows the supplier's original GSTIN.
    expect(screen.getByText('27AABCU1234H1Z1')).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    // Scoped to the modal — PurchaseForm's own "Save purchase" button also matches /save/i.
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^save$/i }))

    // Modal closes once the save resolves.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBe(null))

    // Still on the Add purchase screen — no navigation away.
    expect(screen.getAllByLabelText(/^Supplier\s*\*?$/)[0]).toBeTruthy()

    // The info block now shows the fresh GSTIN returned by updateSupplier (via onSaved →
    // setSuppliers), proving the block actually re-rendered with the new data — not merely that
    // the screen stayed put.
    expect(screen.getByText('29AAAAA0000A1Z5')).toBeTruthy()
    expect(screen.queryByText('27AABCU1234H1Z1')).toBe(null)
  })

  it('leaves the in-progress purchase draft (item row, invoice number) untouched by the edit flow', async () => {
    renderScreen()
    await waitFor(() => screen.getByText('Items'))

    // Seed an actual item/line and an invoice number before touching the supplier-edit flow.
    const { qtyInput, rateInput } = itemRowInputs()
    fireEvent.change(qtyInput, { target: { value: '10' } })
    fireEvent.change(rateInput, { target: { value: '50' } })
    const invoiceNoInput = screen.getByLabelText('Supplier invoice no.') as HTMLInputElement
    fireEvent.change(invoiceNoInput, { target: { value: 'INV-123' } })

    await selectSupplier()
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }))
    await waitFor(() => expect(screen.getByRole('dialog')).toBeTruthy())

    // Change a field inside the modal and save — this must not touch the purchase draft at all.
    const phoneInput = within(screen.getByRole('dialog')).getByLabelText(/^phone/i)
    fireEvent.change(phoneInput, { target: { value: '1111111111' } })
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /^save$/i }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBe(null))

    // The item row still has its original qty/rate, and the invoice number is unchanged.
    const after = itemRowInputs()
    expect(after.qtyInput.value).toBe('10')
    expect(after.rateInput.value).toBe('50')
    expect((screen.getByLabelText('Supplier invoice no.') as HTMLInputElement).value).toBe('INV-123')
  })
})
