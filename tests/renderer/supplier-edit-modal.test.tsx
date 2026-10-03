// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import { SupplierEditModal } from '../../src/renderer/components/SupplierEditModal'
import type { Supplier } from '../../src/shared/types'

const mockSupplier: Supplier = {
  id: 1, name: 'Widget Inc', gstin: '27AABCU1234H1Z1', pan: 'AABCU1234H',
  phone: '9876543210', email: 'widgets@example.com',
  address: '456 Oak Ave', city: 'Mumbai', state: 'MH', pincode: '400001'
}

const updateSupplier = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  updateSupplier.mockResolvedValue({ ...mockSupplier, name: 'Widget Inc Updated' })
  ;(window as unknown as { api: unknown }).api = { updateSupplier }
})

describe('SupplierEditModal', () => {
  it('renders the modal and seeds fields from the supplier prop when open', () => {
    renderWithMantine(
      <SupplierEditModal supplier={mockSupplier} open={true} onClose={() => {}} onSaved={() => {}} />
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('Widget Inc')
    expect((screen.getByLabelText(/^gstin/i) as HTMLInputElement).value).toBe('27AABCU1234H1Z1')
  })

  it('strips non-digits from a typed phone number', () => {
    renderWithMantine(
      <SupplierEditModal supplier={mockSupplier} open={true} onClose={() => {}} onSaved={() => {}} />
    )
    const phone = screen.getByLabelText(/^phone/i) as HTMLInputElement
    fireEvent.change(phone, { target: { value: '98765 D3210' } })
    expect(phone.value).toBe('987653210')
  })

  it('does not render the modal when open is false', () => {
    renderWithMantine(
      <SupplierEditModal supplier={mockSupplier} open={false} onClose={() => {}} onSaved={() => {}} />
    )
    expect(screen.queryByRole('dialog')).toBe(null)
  })

  it('calls updateSupplier with the edited values on save', async () => {
    renderWithMantine(
      <SupplierEditModal supplier={mockSupplier} open={true} onClose={() => {}} onSaved={() => {}} />
    )

    const nameInput = screen.getByLabelText(/^name/i)
    fireEvent.change(nameInput, { target: { value: 'Widget Inc Updated' } })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(updateSupplier).toHaveBeenCalledWith(1, expect.objectContaining({
      name: 'Widget Inc Updated',
      gstin: '27AABCU1234H1Z1',
      pan: 'AABCU1234H'
    })))
  })

  it('calls onSaved with the supplier returned by the API, and closes', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    renderWithMantine(
      <SupplierEditModal supplier={mockSupplier} open={true} onClose={onClose} onSaved={onSaved} />
    )

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Widget Inc Updated' })
    ))
    expect(onClose).toHaveBeenCalled()
  })

  it('cancel discards changes and closes without calling the API', () => {
    const onClose = vi.fn()
    renderWithMantine(
      <SupplierEditModal supplier={mockSupplier} open={true} onClose={onClose} onSaved={() => {}} />
    )

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Some other name' } })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalled()
    expect(updateSupplier).not.toHaveBeenCalled()
  })

  it('blocks save and shows a validation error when a required field is cleared', async () => {
    renderWithMantine(
      <SupplierEditModal supplier={mockSupplier} open={true} onClose={() => {}} onSaved={() => {}} />
    )

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/enter the name/i)).toBeTruthy()
    expect(updateSupplier).not.toHaveBeenCalled()
  })
})
