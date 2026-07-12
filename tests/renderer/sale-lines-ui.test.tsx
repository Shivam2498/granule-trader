// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, within } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import SaleLines from '../../src/renderer/components/SaleLines'
import { newLine, type SaleLineDraft } from '../../src/renderer/lib/sale-lines'
import type { AvailableLot, HsnProduct } from '../../src/shared/types'

const lot = (o: Partial<AvailableLot> & { purchase_item_id: number }): AvailableLot => ({
  purchase_id: 1, our_code: `00${o.purchase_item_id}/2526`, party: 'Reliance', hsn_code: '39021000',
  description: 'PP', invoice_date: '2026-01-12', rate_per_kg: 80, available_kg: 5000, ...o
})

const LOTS = [
  lot({ purchase_item_id: 1, our_code: '0012/2526', invoice_date: '2026-01-12', available_kg: 5000, rate_per_kg: 78 }),
  lot({ purchase_item_id: 2, our_code: '0015/2526', invoice_date: '2026-01-20', available_kg: 5000, rate_per_kg: 80 }),
  lot({ purchase_item_id: 3, our_code: '0019/2526', invoice_date: '2026-02-02', available_kg: 4000, rate_per_kg: 85 }),
  lot({ purchase_item_id: 9, our_code: '0021/2526', hsn_code: '39012000', description: 'HDPE', available_kg: 900, rate_per_kg: 70 })
]

const HSN: HsnProduct[] = [
  { hsn_code: '39021000', description: 'PP Granules', gst_rate: 18 },
  { hsn_code: '39012000', description: 'HDPE', gst_rate: 18 }
]

function setup(lines: SaleLineDraft[] = []) {
  const onChange = vi.fn()
  renderWithMantine(<SaleLines lots={LOTS} hsn={HSN} asOfDate="2026-07-12" lines={lines} onChange={onChange} />)
  return { onChange }
}

const lineCard = (hsn: string) => screen.getByLabelText(`Remove ${hsn}`).closest('div')!.parentElement!.parentElement!

describe('SaleLines', () => {
  it('starts with nothing on the invoice', () => {
    setup()
    expect(screen.getByText('Nothing added yet — choose a material above.')).toBeTruthy()
  })

  it('cannot add until material, quantity and rate are all given', () => {
    setup()
    expect((screen.getByRole('button', { name: /add to invoice/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows a deal as ONE row per material, with the lots as a subtitle', () => {
    setup([newLine(LOTS, '39021000', 12000, 92)])
    const card = lineCard('39021000')
    expect(within(card).getByText('39021000 · PP Granules')).toBeTruthy()
    // the FIFO split is shown, but the user never had to pick it
    expect(within(card).getByText('from 0012/2526 · 0015/2526 · 0019/2526')).toBeTruthy()
    expect(within(card).getByText('₹11,04,000.00')).toBeTruthy()
  })

  it('prices against the weighted cost of the lots actually drawn', () => {
    setup([newLine(LOTS, '39021000', 12000, 92)])
    // 5000@78 + 5000@80 + 2000@85 = ₹80.00/kg weighted
    expect(screen.getByText(/cost ₹80.00\/kg/)).toBeTruthy()
    expect(screen.getByText(/\+₹12.00\/kg margin/)).toBeTruthy()
  })

  it('calls out a deal struck below cost', () => {
    setup([newLine(LOTS, '39021000', 5000, 70)])   // cost 78, selling at 70
    expect(screen.getByText(/₹8.00\/kg below cost/)).toBeTruthy()
  })

  it('re-runs the oldest-first fill when the quantity changes', () => {
    const { onChange } = setup([newLine(LOTS, '39021000', 12000, 92)])
    const card = lineCard('39021000')
    fireEvent.change(within(card).getByDisplayValue('12,000'), { target: { value: '3000' } })
    const next = onChange.mock.calls.at(-1)![0]
    expect(next[0].allocations).toEqual([{ purchase_item_id: 1, qty: 3000 }])   // just the oldest lot now
  })

  it('removes a whole deal', () => {
    const { onChange } = setup([newLine(LOTS, '39021000', 1000, 92)])
    fireEvent.click(screen.getByLabelText('Remove 39021000'))
    expect(onChange).toHaveBeenCalledWith([])
  })

  it('hides the lot table until you ask to change lots', () => {
    setup([newLine(LOTS, '39021000', 12000, 92)])
    expect(screen.getByText('change lots')).toBeTruthy()
    fireEvent.click(screen.getByText('change lots'))
    expect(screen.getByText('hide lots')).toBeTruthy()
    expect(screen.getByText(/Lots take 12000 kg of the 12000 kg/)).toBeTruthy()
  })

  it('taking a lot by hand marks the line manual, so the fill stops overriding it', () => {
    const { onChange } = setup([newLine(LOTS, '39021000', 12000, 92)])
    fireEvent.click(screen.getByText('change lots'))
    const row = screen.getByText('0019/2526').closest('tr')!
    fireEvent.change(within(row).getByDisplayValue('2,000'), { target: { value: '1500' } })
    const next = onChange.mock.calls.at(-1)![0]
    expect(next[0].manual).toBe(true)
    expect(next[0].allocations.find((a: any) => a.purchase_item_id === 3).qty).toBe(1500)
  })

  it('flags hand-picked lots that no longer add up to the quantity sold', () => {
    const drifted: SaleLineDraft = {
      hsn_code: '39021000', qty_kg: 12000, rate_per_kg: 92, manual: true,
      allocations: [{ purchase_item_id: 1, qty: 5000 }]
    }
    setup([drifted])
    expect(screen.getByText(/The lots add up to 5000 kg but the line sells 12000 kg/)).toBeTruthy()
  })

  it('totals every deal on the invoice', () => {
    setup([newLine(LOTS, '39021000', 12000, 92), newLine(LOTS, '39012000', 900, 85)])
    expect(screen.getByText('12900 kg')).toBeTruthy()
    expect(screen.getByText('₹11,80,500.00')).toBeTruthy()   // 1104000 + 76500
  })
})
