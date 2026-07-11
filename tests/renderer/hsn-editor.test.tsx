// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import HsnEditor from '../../src/renderer/components/HsnEditor'

const listHsn = vi.fn()
const upsertHsn = vi.fn()
const deleteHsn = vi.fn()

const codeInput = () => screen.getByLabelText(/HSN code/i) as HTMLInputElement
const descInput = () => screen.getByLabelText(/Description/i) as HTMLInputElement
const btn = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
  listHsn.mockResolvedValue([{ hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 }])
  upsertHsn.mockResolvedValue(undefined)
  deleteHsn.mockResolvedValue(undefined)
  ;(window as unknown as { api: unknown }).api = { listHsn, upsertHsn, deleteHsn }
})

describe('HsnEditor', () => {
  it('lists existing products', async () => {
    renderWithMantine(<HsnEditor />)
    expect(await screen.findByText('Polypropylene')).toBeTruthy()
  })

  it('Edit prefills the form and locks the HSN code', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))

    expect(codeInput().value).toBe('3902')
    expect(codeInput().disabled).toBe(true)
    expect(descInput().value).toBe('Polypropylene')
    expect(btn(/save changes/i)).toBeTruthy()
  })

  it('saves an edited description against the original code', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))
    fireEvent.change(descInput(), { target: { value: 'PP Granules' } })
    fireEvent.click(btn(/save changes/i))

    await waitFor(() => expect(upsertHsn).toHaveBeenCalledWith(
      { hsn_code: '3902', description: 'PP Granules', gst_rate: 5 }
    ))
  })

  it('Cancel returns the form to add mode', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))
    fireEvent.click(btn(/cancel/i))

    expect(codeInput().value).toBe('')
    expect(codeInput().disabled).toBe(false)
    expect(btn(/^add$/i)).toBeTruthy()
  })

  it('adds a new product and clears the form', async () => {
    renderWithMantine(<HsnEditor />)
    await screen.findByText('Polypropylene')
    fireEvent.change(codeInput(), { target: { value: '3901' } })
    fireEvent.change(descInput(), { target: { value: 'LLDPE' } })
    fireEvent.click(btn(/^add$/i))

    await waitFor(() => expect(upsertHsn).toHaveBeenCalledWith(
      { hsn_code: '3901', description: 'LLDPE', gst_rate: 18 }
    ))
    await waitFor(() => expect(codeInput().value).toBe(''))
  })

  it('deletes after confirmation and refreshes the list', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /delete/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^delete product$/i }))

    await waitFor(() => expect(deleteHsn).toHaveBeenCalledWith('3902'))
    await waitFor(() => expect(listHsn).toHaveBeenCalledTimes(2))   // initial load + refresh after delete
  })

  it('shows the guard message when a delete is refused', async () => {
    deleteHsn.mockRejectedValue(new Error("Product 3902 is used by 1 purchase, so it can't be deleted."))
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /delete/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^delete product$/i }))

    expect(await screen.findByText(/used by 1 purchase/i)).toBeTruthy()
  })
})
