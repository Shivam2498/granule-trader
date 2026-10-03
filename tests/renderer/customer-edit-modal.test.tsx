// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import { CustomerEditModal } from '../../src/renderer/components/CustomerEditModal'
import type { Customer } from '../../src/shared/types'

const mockCustomer: Customer = {
  id: 1, name: 'Acme Corp', gstin: '27AABCU1234H1Z0', pan: 'AABCU1234H',
  phone: '9876543210', email: 'acme@example.com',
  billing_address: '123 Main St', billing_city: 'Delhi', billing_state: 'Delhi', billing_pincode: '110001',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

const updateCustomer = vi.fn()

beforeEach(() => {
  vi.clearAllMocks()
  updateCustomer.mockResolvedValue({ ...mockCustomer, name: 'Acme Corp Updated' })
  ;(window as unknown as { api: unknown }).api = { updateCustomer }
})

describe('CustomerEditModal', () => {
  it('renders the modal and seeds fields from the customer prop when open', () => {
    renderWithMantine(
      <CustomerEditModal customer={mockCustomer} open={true} onClose={() => {}} onSaved={() => {}} />
    )
    expect(screen.getByRole('dialog')).toBeTruthy()
    expect((screen.getByLabelText(/^name/i) as HTMLInputElement).value).toBe('Acme Corp')
    expect((screen.getByLabelText(/^gstin/i) as HTMLInputElement).value).toBe('27AABCU1234H1Z0')
  })

  it('does not render the modal when open is false', () => {
    renderWithMantine(
      <CustomerEditModal customer={mockCustomer} open={false} onClose={() => {}} onSaved={() => {}} />
    )
    expect(screen.queryByRole('dialog')).toBe(null)
  })

  it('calls updateCustomer with the edited values on save', async () => {
    renderWithMantine(
      <CustomerEditModal customer={mockCustomer} open={true} onClose={() => {}} onSaved={() => {}} />
    )

    const nameInput = screen.getByLabelText(/^name/i)
    fireEvent.change(nameInput, { target: { value: 'Acme Corp Updated' } })

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(updateCustomer).toHaveBeenCalledWith(1, expect.objectContaining({
      name: 'Acme Corp Updated',
      gstin: '27AABCU1234H1Z0',
      pan: 'AABCU1234H'
    })))
  })

  it('calls onSaved with the customer returned by the API, and closes', async () => {
    const onSaved = vi.fn()
    const onClose = vi.fn()
    renderWithMantine(
      <CustomerEditModal customer={mockCustomer} open={true} onClose={onClose} onSaved={onSaved} />
    )

    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: 'Acme Corp Updated' })
    ))
    expect(onClose).toHaveBeenCalled()
  })

  it('cancel discards changes and closes without calling the API', () => {
    const onClose = vi.fn()
    renderWithMantine(
      <CustomerEditModal customer={mockCustomer} open={true} onClose={onClose} onSaved={() => {}} />
    )

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: 'Some other name' } })
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }))

    expect(onClose).toHaveBeenCalled()
    expect(updateCustomer).not.toHaveBeenCalled()
  })

  it('blocks save and shows a validation error when a required field is cleared', async () => {
    renderWithMantine(
      <CustomerEditModal customer={mockCustomer} open={true} onClose={() => {}} onSaved={() => {}} />
    )

    fireEvent.change(screen.getByLabelText(/^name/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText(/enter the name/i)).toBeTruthy()
    expect(updateCustomer).not.toHaveBeenCalled()
  })
})
