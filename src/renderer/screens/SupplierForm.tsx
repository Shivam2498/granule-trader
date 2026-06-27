import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TextInput, Textarea, Button, Input } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Supplier } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { vGstin, vPhoneOptional, vPincode } from '../lib/formValidators'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

const EMPTY: Omit<Supplier, 'id'> = {
  name: '', gstin: '', pan: '', phone: '', address: '', city: '', state: '', pincode: ''
}

export default function SupplierForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [error, setError] = useState('')

  const form = useForm<Omit<Supplier, 'id'>>({
    mode: 'controlled',
    initialValues: EMPTY,
    validateInputOnBlur: true,
    validate: {
      name: isNotEmpty('Enter the name.'),
      gstin: vGstin,
      phone: vPhoneOptional,
      city: isNotEmpty('Enter the city.'),
      state: isNotEmpty('Choose the state.'),
      address: isNotEmpty('Enter the address.'),
      pincode: vPincode
    }
  })

  useEffect(() => {
    if (!editId) return
    window.api.listSuppliers().then(all => {
      const s = all.find(x => x.id === editId)
      if (s) { const { id: _i, ...rest } = s; form.setValues(rest) }
      else { setError('Record not found.'); nav('/suppliers') }
    }).catch(e => setError(e.message ?? String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  async function handleSave(values: Omit<Supplier, 'id'>) {
    setError('')
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      if (editId) await window.api.updateSupplier(editId, payload); else await window.api.createSupplier(payload)
      notifications.show({ message: 'Supplier saved', color: 'green' })
      nav('/suppliers')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <FormPage title={editId ? 'Edit supplier' : 'Add supplier'} onBack={() => nav('/suppliers')} error={error}
      footer={<>
        <Button variant="default" onClick={() => nav('/suppliers')}>Cancel</Button>
        <Button onClick={() => form.onSubmit(handleSave)()}>Save supplier</Button>
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
        <TextInput label="Phone" {...form.getInputProps('phone')}
          onChange={e => form.setFieldValue('phone', e.currentTarget.value.replace(/\D/g, '').slice(0, 10))} />
      </FormSection>
      <FormSection title="Address">
        <Input.Wrapper label="Pincode" withAsterisk error={form.errors.pincode}>
          <PincodeField value={form.values.pincode} onChange={v => form.setFieldValue('pincode', v)}
            onResolved={r => { form.setFieldValue('city', r.city); form.setFieldValue('state', r.state) }} />
        </Input.Wrapper>
        <TextInput label="City" withAsterisk {...form.getInputProps('city')} />
        <Input.Wrapper label="State" withAsterisk error={form.errors.state}>
          <StateSelect value={form.values.state} onChange={v => form.setFieldValue('state', v)} />
        </Input.Wrapper>
        <Textarea label="Address" withAsterisk autosize minRows={2} {...form.getInputProps('address')} />
      </FormSection>
    </FormPage>
  )
}
