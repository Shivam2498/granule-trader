import { useEffect, useState } from 'react'
import { Modal, Button, Group, Alert } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Supplier } from '@shared/types'
import { SupplierFields, supplierFormOptions } from './SupplierFields'

export function SupplierEditModal({
  supplier,
  open,
  onClose,
  onSaved
}: {
  supplier: Supplier
  open: boolean
  onClose: () => void
  onSaved: (updated: Supplier) => void
}) {
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const form = useForm<Omit<Supplier, 'id'>>(supplierFormOptions)

  // Re-seed from the supplier prop every time the modal opens, so a cancelled edit never
  // leaks into the next open and switching which supplier is being edited always starts fresh.
  useEffect(() => {
    if (open) {
      const { id: _id, ...rest } = supplier
      form.setValues(rest)
      form.resetDirty(rest)
      setError('')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, supplier])

  async function handleSave(values: Omit<Supplier, 'id'>) {
    if (saving) return
    setSaving(true)
    setError('')
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      const updated = await window.api.updateSupplier(supplier.id, payload)
      notifications.show({ message: 'Supplier saved', color: 'green' })
      onSaved(updated)
      onClose()
    } catch (e: any) {
      setError(e.message ?? String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal opened={open} onClose={onClose} title="Edit supplier" size="lg">
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <SupplierFields form={form} />
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onClose}>Cancel</Button>
        <Button loading={saving} onClick={() => form.onSubmit(handleSave)()}>Save</Button>
      </Group>
    </Modal>
  )
}
