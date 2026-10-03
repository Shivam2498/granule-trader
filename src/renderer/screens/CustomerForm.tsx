import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Customer } from '@shared/types'
import { vGstin, vPhoneOptional, vPincode, vEmailOptional } from '../lib/formValidators'
import FormPage from '../components/FormPage'
import { CustomerFields } from '../components/CustomerFields'

const EMPTY: Omit<Customer, 'id'> = {
  name: '', gstin: '', pan: '', phone: '', email: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

export default function CustomerForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
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
