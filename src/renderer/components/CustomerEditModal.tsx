import { useEffect, useState } from 'react'
import { Modal, Button, Group, Alert } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Customer } from '@shared/types'
import { CustomerFields, customerFormOptions } from './CustomerFields'

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

  const form = useForm<Omit<Customer, 'id'>>(customerFormOptions)

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
