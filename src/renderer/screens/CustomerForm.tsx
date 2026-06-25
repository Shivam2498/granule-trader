import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TextInput, Textarea, Checkbox, Button, Input } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { Customer } from '@shared/types'
import { isGstin, isMobile, isPincode, panFromGstin, VMSG } from '@shared/validation'
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
  const [form, setForm] = useState<Omit<Customer, 'id'>>(EMPTY)
  const [error, setError] = useState('')
  const set = (p: Partial<Omit<Customer, 'id'>>) => setForm(f => ({ ...f, ...p }))

  useEffect(() => {
    if (!editId) return
    window.api.listCustomers().then(all => {
      const c = all.find(x => x.id === editId)
      if (c) { const { id: _i, ...rest } = c; setForm(rest) }
    }).catch(e => setError(e.message ?? String(e)))
  }, [editId])

  const errs: Record<string, string> = {
    name: form.name.trim() ? '' : 'Enter the name.',
    gstin: isGstin(form.gstin) ? '' : VMSG.gstin,
    phone: isMobile(form.phone) ? '' : VMSG.phone,
    billing_city: form.billing_city.trim() ? '' : 'Enter the city.',
    billing_state: form.billing_state.trim() ? '' : 'Choose the state.',
    billing_pincode: isPincode(form.billing_pincode) ? '' : VMSG.pincode,
    billing_address: form.billing_address.trim() ? '' : 'Enter the address.',
    ...(form.shipping_same ? {} : {
      shipping_address: form.shipping_address.trim() ? '' : 'Enter the shipping address.',
      shipping_city: form.shipping_city.trim() ? '' : 'Enter the shipping city.',
      shipping_state: form.shipping_state.trim() ? '' : 'Choose the shipping state.',
      shipping_pincode: isPincode(form.shipping_pincode) ? '' : VMSG.pincode
    })
  }
  const valid = Object.values(errs).every(e => e === '')

  async function save() {
    setError('')
    if (!valid) { setError('Please fix the highlighted fields below.'); return }
    try {
      const payload = { ...form, gstin: form.gstin.toUpperCase(), pan: form.pan.toUpperCase() }
      if (editId) await window.api.updateCustomer(editId, payload); else await window.api.createCustomer(payload)
      notifications.show({ message: 'Customer saved', color: 'green' })
      nav('/customers')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  const cancel = () => nav('/customers')

  return (
    <FormPage title={editId ? 'Edit customer' : 'Add customer'} onBack={() => nav('/customers')} error={error}
      footer={<><Button variant="default" onClick={cancel}>Cancel</Button><Button disabled={!valid} onClick={save}>Save customer</Button></>}>
      <FormSection title="Business details">
        <TextInput label="Name" withAsterisk value={form.name} onChange={e => set({ name: e.currentTarget.value })} error={errs.name} />
        <TextInput label="GSTIN" withAsterisk value={form.gstin}
          onChange={e => set({ gstin: e.currentTarget.value.toUpperCase(), pan: panFromGstin(e.currentTarget.value) })}
          error={errs.gstin} />
        <TextInput label="PAN (from GSTIN)" disabled value={form.pan} />
        <TextInput label="Phone" withAsterisk value={form.phone} onChange={e => set({ phone: e.currentTarget.value.replace(/\D/g, '').slice(0,10) })} error={errs.phone} />
      </FormSection>
      <FormSection title="Billing address">
        <Input.Wrapper label="Pincode" error={errs.billing_pincode}>
          <PincodeField value={form.billing_pincode} onChange={v => set({ billing_pincode: v })}
            onResolved={r => set({ billing_city: r.city, billing_state: r.state })} />
        </Input.Wrapper>
        <TextInput label="City" value={form.billing_city} onChange={e => set({ billing_city: e.currentTarget.value })} error={errs.billing_city} />
        <Input.Wrapper label="State" error={errs.billing_state}>
          <StateSelect value={form.billing_state} onChange={v => set({ billing_state: v })} />
        </Input.Wrapper>
        <Textarea label="Address" autosize minRows={2} value={form.billing_address} onChange={e => set({ billing_address: e.currentTarget.value })} error={errs.billing_address} />
      </FormSection>
      <Checkbox label="Shipping address is the same as billing" checked={form.shipping_same} onChange={e => set({ shipping_same: e.currentTarget.checked })} />
      {!form.shipping_same && (
        <FormSection title="Shipping address">
          <Input.Wrapper label="Pincode" error={errs.shipping_pincode}>
            <PincodeField value={form.shipping_pincode} onChange={v => set({ shipping_pincode: v })}
              onResolved={r => set({ shipping_city: r.city, shipping_state: r.state })} />
          </Input.Wrapper>
          <TextInput label="City" value={form.shipping_city} onChange={e => set({ shipping_city: e.currentTarget.value })} error={errs.shipping_city} />
          <Input.Wrapper label="State" error={errs.shipping_state}>
            <StateSelect value={form.shipping_state} onChange={v => set({ shipping_state: v })} />
          </Input.Wrapper>
          <Textarea label="Address" autosize minRows={2} value={form.shipping_address} onChange={e => set({ shipping_address: e.currentTarget.value })} error={errs.shipping_address} />
        </FormSection>
      )}
    </FormPage>
  )
}
