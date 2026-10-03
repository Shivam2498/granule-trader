import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Button } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Supplier } from '@shared/types'
import { vGstin, vPhoneOptional, vPincode, vEmailOptional } from '../lib/formValidators'
import FormPage from '../components/FormPage'
import { SupplierFields } from '../components/SupplierFields'

const EMPTY: Omit<Supplier, 'id'> = {
  name: '', gstin: '', pan: '', phone: '', email: '', address: '', city: '', state: '', pincode: ''
}

export default function SupplierForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const form = useForm<Omit<Supplier, 'id'>>({
    mode: 'controlled',
    initialValues: EMPTY,
    validateInputOnBlur: true,
    validate: {
      name: isNotEmpty('Enter the name.'),
      gstin: vGstin,
      phone: vPhoneOptional,
      email: vEmailOptional,
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
    if (saving) return
    setError('')
    setSaving(true)
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      if (editId) await window.api.updateSupplier(editId, payload); else await window.api.createSupplier(payload)
      notifications.show({ message: 'Supplier saved', color: 'green' })
      nav('/suppliers')
    } catch (e: any) { setError(e.message ?? String(e)); setSaving(false) }
  }

  return (
    <FormPage title={editId ? 'Edit supplier' : 'Add supplier'} onBack={() => nav('/suppliers')} error={error}
      footer={<>
        <Button variant="default" onClick={() => nav('/suppliers')}>Cancel</Button>
        <Button loading={saving} onClick={() => form.onSubmit(handleSave)()}>Save supplier</Button>
      </>}>
      <SupplierFields form={form} />
    </FormPage>
  )
}
