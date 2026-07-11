// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import LotPicker, { type Draw } from '../../src/renderer/components/LotPicker'
import type { AvailableLot, HsnProduct } from '../../src/shared/types'

const lot = (o: Partial<AvailableLot> & { purchase_item_id: number }): AvailableLot => ({
  purchase_id: 1, our_code: `00${o.purchase_item_id}/2526`, party: 'Reliance', hsn_code: '39021000',
  description: 'PP', invoice_date: '2026-01-12', rate_per_kg: 80, available_kg: 5000, ...o
})

const hsn: HsnProduct[] = [
  { hsn_code: '39021000', description: 'PP Granules', gst_rate: 18 },
  { hsn_code: '39012000', description: 'HDPE', gst_rate: 18 }
]

const LOTS = [
  lot({ purchase_item_id: 1, our_code: '0012/2526', invoice_date: '2026-01-12', available_kg: 5000 }),
  lot({ purchase_item_id: 2, our_code: '0015/2526', invoice_date: '2026-01-20', available_kg: 5000 }),
  lot({ purchase_item_id: 3, our_code: '0019/2526', invoice_date: '2026-02-02', available_kg: 4000 }),
  lot({ purchase_item_id: 4, our_code: '0021/2526', hsn_code: '39012000', description: 'HDPE', available_kg: 900 })
]

function setup(chosen: Record<number, Draw> = {}) {
  const onChange = vi.fn()
  renderWithMantine(
    <LotPicker lots={LOTS} hsn={hsn} asOfDate="2026-07-11" chosen={chosen} onChange={onChange} />
  )
  return { onChange }
}

const finder = () => screen.getByText('Add stock to this sale').closest('div')!.parentElement!

describe('LotPicker', () => {
  it('shows how much stock is on offer', () => {
    setup()
    expect(screen.getByText(/4 lots · 14900 kg available/)).toBeTruthy()
  })

  it('adds a lot when Add is pressed', () => {
    const { onChange } = setup()
    const row = screen.getByText('0015/2526').closest('tr')!
    fireEvent.click(within(row).getByRole('button', { name: /add/i }))
    expect(onChange).toHaveBeenCalledWith({ 2: { qty: 0, rate: 0 } })
  })

  it('narrows the list by a lot-code search', () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Search/i), { target: { value: '0019' } })
    expect(screen.getByText(/1 lot · 4000 kg available/)).toBeTruthy()
    expect(screen.queryByText('0012/2526')).toBeNull()
  })

  it('hides lots already on the sale, so the same lot cannot be added twice', () => {
    setup({ 1: { qty: 1000, rate: 90 } })
    // the finder no longer offers lot 1 …
    expect(screen.getByText(/3 lots · 9900 kg available/)).toBeTruthy()
    // … but it is listed in the sale, with its inputs
    const chosenRow = screen.getByLabelText('Remove 0012/2526').closest('tr')!
    expect(within(chosenRow).getByText('39021000')).toBeTruthy()
  })

  it('removes a chosen lot', () => {
    const { onChange } = setup({ 1: { qty: 1000, rate: 90 } })
    fireEvent.click(screen.getByLabelText('Remove 0012/2526'))
    expect(onChange).toHaveBeenCalledWith({})
  })

  it('warns when a chosen quantity exceeds what the lot holds', () => {
    setup({ 3: { qty: 9999, rate: 90 } })   // lot 3 only has 4000
    expect(screen.getByText('Only 4000 kg available.')).toBeTruthy()
  })

  it('says there is nothing to show when no lot matches', () => {
    setup()
    fireEvent.change(screen.getByLabelText(/Search/i), { target: { value: 'nylon' } })
    expect(screen.getByText(/No lots match/)).toBeTruthy()
  })

  it('empty state points at the date, since availability is date-scoped', () => {
    const onChange = vi.fn()
    renderWithMantine(<LotPicker lots={[]} hsn={hsn} asOfDate="2026-07-11" chosen={{}} onChange={onChange} />)
    expect(screen.getByText('No stock available on 2026-07-11.')).toBeTruthy()
  })

  it('Fill is disabled until a material and a quantity are chosen', () => {
    setup()
    expect((screen.getByRole('button', { name: /^fill$/i }) as HTMLButtonElement).disabled).toBe(true)
  })
})
