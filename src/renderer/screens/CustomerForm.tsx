import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@mantine/core'
import { useForm } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Customer } from '@shared/types'
import FormPage from '../components/FormPage'
import { CustomerFields, customerFormOptions } from '../components/CustomerFields'

export default function CustomerForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const form = useForm<Omit<Customer, 'id'>>(customerFormOptions)

  useEffect(() => {
    if (!editId) return
    window.api.listCustomers().then(all => {
      const c = all.find(x => x.id === editId)
      if (c) { const { id: _i, ...rest } = c; form.setValues(rest) }
      else { setError('Record not found.'); nav('/customers') }
    }).catch(e => setError(e.message ?? String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  async function handleSave(values: Omit<Customer, 'id'>) {
    if (saving) return
    setError('')
    setSaving(true)
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      if (editId) await window.api.updateCustomer(editId, payload); else await window.api.createCustomer(payload)
      notifications.show({ message: 'Customer saved', color: 'green' })
      nav('/customers')
    } catch (e: any) { setError(e.message ?? String(e)); setSaving(false) }
  }

  return (
    <FormPage title={editId ? 'Edit customer' : 'Add customer'} onBack={() => nav('/customers')} error={error}
      footer={<>
        <Button variant="default" onClick={() => nav('/customers')}>Cancel</Button>
        <Button loading={saving} onClick={() => form.onSubmit(handleSave)()}>Save customer</Button>
      </>}>
      <CustomerFields form={form} />
    </FormPage>
  )
}
