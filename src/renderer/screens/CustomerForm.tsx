import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Customer } from '@shared/types'
import { isGstin, isPan, isMobile, isPincode } from '@shared/validation'
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
    name: form.name.trim() ? '' : 'Required',
    gstin: isGstin(form.gstin) ? '' : 'Invalid GSTIN (e.g. 24ABCDE1234F1Z5)',
    pan: !form.pan || isPan(form.pan) ? '' : 'PAN must be 10 characters',
    phone: !form.phone || isMobile(form.phone) ? '' : '10-digit mobile',
    billing_city: form.billing_city.trim() ? '' : 'Required',
    billing_state: form.billing_state.trim() ? '' : 'Required',
    billing_pincode: isPincode(form.billing_pincode) ? '' : '6-digit pincode',
    billing_address: form.billing_address.trim() ? '' : 'Required',
    ...(form.shipping_same ? {} : {
      shipping_address: form.shipping_address.trim() ? '' : 'Required',
      shipping_city: form.shipping_city.trim() ? '' : 'Required',
      shipping_state: form.shipping_state.trim() ? '' : 'Required',
      shipping_pincode: isPincode(form.shipping_pincode) ? '' : '6-digit pincode'
    })
  }
  const valid = Object.values(errs).every(e => e === '')

  async function save() {
    setError('')
    if (!valid) { setError('Please fix the highlighted fields.'); return }
    try {
      const payload = { ...form, gstin: form.gstin.toUpperCase(), pan: form.pan.toUpperCase() }
      if (editId) await window.api.updateCustomer(editId, payload); else await window.api.createCustomer(payload)
      nav('/customers')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  const F = (label: string, node: React.ReactNode, err?: string, full?: boolean) => (
    <div className={'field' + (full ? ' full' : '')}><label>{label}</label>{node}{err ? <div className="err">{err}</div> : null}</div>
  )

  return (
    <FormPage title={editId ? 'Edit customer' : 'Add customer'} onBack={() => nav('/customers')} error={error}
      footer={<><button onClick={() => nav('/customers')}>Cancel</button><button className="primary" disabled={!valid} onClick={save}>Save customer</button></>}>
      <FormSection title="Business details">
        {F('Name', <input value={form.name} onChange={e => set({ name: e.target.value })} />, errs.name)}
        {F('GSTIN', <input value={form.gstin} onChange={e => set({ gstin: e.target.value.toUpperCase() })} />, errs.gstin)}
        {F('PAN', <input value={form.pan} onChange={e => set({ pan: e.target.value.toUpperCase() })} />, errs.pan)}
        {F('Phone', <input value={form.phone} onChange={e => set({ phone: e.target.value.replace(/\D/g, '').slice(0,10) })} />, errs.phone)}
      </FormSection>
      <FormSection title="Billing address">
        {F('Pincode', <PincodeField value={form.billing_pincode} onChange={v => set({ billing_pincode: v })}
            onResolved={r => set({ billing_city: r.city, billing_state: r.state })} />, errs.billing_pincode)}
        {F('City', <input value={form.billing_city} onChange={e => set({ billing_city: e.target.value })} />, errs.billing_city)}
        {F('State', <StateSelect value={form.billing_state} onChange={v => set({ billing_state: v })} />, errs.billing_state)}
        {F('Address', <textarea rows={2} value={form.billing_address} onChange={e => set({ billing_address: e.target.value })} />, errs.billing_address, true)}
      </FormSection>
      <label style={{ display: 'block', margin: '4px 0 14px' }}>
        <input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={form.shipping_same} onChange={e => set({ shipping_same: e.target.checked })} />
        Shipping address is the same as billing
      </label>
      {!form.shipping_same && (
        <FormSection title="Shipping address">
          {F('Pincode', <PincodeField value={form.shipping_pincode} onChange={v => set({ shipping_pincode: v })}
              onResolved={r => set({ shipping_city: r.city, shipping_state: r.state })} />, errs.shipping_pincode)}
          {F('City', <input value={form.shipping_city} onChange={e => set({ shipping_city: e.target.value })} />, errs.shipping_city)}
          {F('State', <StateSelect value={form.shipping_state} onChange={v => set({ shipping_state: v })} />, errs.shipping_state)}
          {F('Address', <textarea rows={2} value={form.shipping_address} onChange={e => set({ shipping_address: e.target.value })} />, errs.shipping_address, true)}
        </FormSection>
      )}
    </FormPage>
  )
}
