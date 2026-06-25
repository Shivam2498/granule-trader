import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TextInput, Textarea, Checkbox, Button, Input } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

const EMPTY: Omit<Customer, 'id'> = {
  name: '', gstin: '', pan: '', phone: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

export default function CustomerForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [error, setError] = useState('')

  const form = useForm<Omit<Customer, 'id'>>({
    mode: 'controlled',
    initialValues: EMPTY,
    validate: {
      name: isNotEmpty('Enter the name.'),
      gstin: vGstin,
      phone: vPhone,
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
    }).catch(e => setError(e.message ?? String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  async function handleSave(values: Omit<Customer, 'id'>) {
    setError('')
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      if (editId) await window.api.updateCustomer(editId, payload); else await window.api.createCustomer(payload)
      notifications.show({ message: 'Customer saved', color: 'green' })
      nav('/customers')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <FormPage title={editId ? 'Edit customer' : 'Add customer'} onBack={() => nav('/customers')} error={error}
      footer={<>
        <Button variant="default" onClick={() => nav('/customers')}>Cancel</Button>
        <Button onClick={() => form.onSubmit(handleSave)()}>Save customer</Button>
      </>}>
      <FormSection title="Business details">
        <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
        <TextInput label="GSTIN" withAsterisk {...form.getInputProps('gstin')}
          onChange={e => {
            const v = e.currentTarget.value.toUpperCase()
            form.setFieldValue('gstin', v)
            form.setFieldValue('pan', panFromGstin(v))
          }} />
        <TextInput label="PAN (from GSTIN)" disabled value={form.values.pan} />
        <TextInput label="Phone" withAsterisk {...form.getInputProps('phone')}
          onChange={e => form.setFieldValue('phone', e.currentTarget.value.replace(/\D/g, '').slice(0, 10))} />
      </FormSection>
      <FormSection title="Billing address">
        <Input.Wrapper label="Pincode" error={form.errors.billing_pincode}>
          <PincodeField value={form.values.billing_pincode} onChange={v => form.setFieldValue('billing_pincode', v)}
            onResolved={r => { form.setFieldValue('billing_city', r.city); form.setFieldValue('billing_state', r.state) }} />
        </Input.Wrapper>
        <TextInput label="City" {...form.getInputProps('billing_city')} />
        <Input.Wrapper label="State" error={form.errors.billing_state}>
          <StateSelect value={form.values.billing_state} onChange={v => form.setFieldValue('billing_state', v)} />
        </Input.Wrapper>
        <Textarea label="Address" autosize minRows={2} {...form.getInputProps('billing_address')} />
      </FormSection>
      <Checkbox label="Shipping address is the same as billing" {...form.getInputProps('shipping_same', { type: 'checkbox' })} />
      {!form.values.shipping_same && (
        <FormSection title="Shipping address">
          <Input.Wrapper label="Pincode" error={form.errors.shipping_pincode}>
            <PincodeField value={form.values.shipping_pincode} onChange={v => form.setFieldValue('shipping_pincode', v)}
              onResolved={r => { form.setFieldValue('shipping_city', r.city); form.setFieldValue('shipping_state', r.state) }} />
          </Input.Wrapper>
          <TextInput label="City" {...form.getInputProps('shipping_city')} />
          <Input.Wrapper label="State" error={form.errors.shipping_state}>
            <StateSelect value={form.values.shipping_state} onChange={v => form.setFieldValue('shipping_state', v)} />
          </Input.Wrapper>
          <Textarea label="Address" autosize minRows={2} {...form.getInputProps('shipping_address')} />
        </FormSection>
      )}
    </FormPage>
  )
}
