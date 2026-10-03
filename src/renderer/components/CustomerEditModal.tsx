import { useEffect, useState } from 'react'
import { Modal, Button, Group, Alert } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Customer } from '@shared/types'
import { vGstin, vPhoneOptional, vPincode, vEmailOptional } from '../lib/formValidators'
import { CustomerFields } from './CustomerFields'

const EMPTY: Omit<Customer, 'id'> = {
  name: '', gstin: '', pan: '', phone: '', email: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

export function CustomerEditModal({
  customer,
  open,
  onClose,
  onSaved
}: {
  customer: Customer
  open: boolean
  onClose: () => void
  onSaved: (updated: Customer) => void
}) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const form = useForm<Omit<Customer, 'id'>>({
    mode: 'controlled',
    initialValues: EMPTY,
    validate: {
      name: isNotEmpty('Enter the name.'),
      gstin: vGstin,
      phone: vPhoneOptional,
      email: vEmailOptional,
      billing_city: isNotEmpty('Enter the city.'),
      billing_state: isNotEmpty('Choose the state.'),
      billing_pincode: vPincode,
      billing_address: isNotEmpty('Enter the address.'),
      shipping_address: (v, values) => values.shipping_same ? null : (v.trim() ? null : 'Enter the shipping address.'),
      shipping_city: (v, values) => values.shipping_same ? null : (v.trim() ? null : 'Enter the shipping city.'),
      shipping_state: (v, values) => values.shipping_same ? null : (v.trim() ? null : 'Choose the shipping state.'),
      shipping_pincode: (v, values) => values.shipping_same ? null : vPincode(v)
    }
  })

  // Re-seed from the customer prop every time the modal opens, so a cancelled edit never
  // leaks into the next open and switching which customer is being edited always starts fresh.
  useEffect(() => {
    if (open) {
      const { id: _id, ...rest } = customer
      form.setValues(rest)
      form.resetDirty(rest)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, customer])

  async function handleSave(values: Omit<Customer, 'id'>) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      const updated = await window.api.updateCustomer(customer.id, payload)
      notifications.show({ message: 'Customer saved', color: 'green' })
      onSaved(updated)
      onClose()
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened={open} onClose={onClose} title="Edit customer" size="lg">
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <CustomerFields form={form} />
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={() => form.onSubmit(handleSave)()}>Save</Button>
      </Group>
    </Modal>
  )
}
