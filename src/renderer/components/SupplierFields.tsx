import { TextInput, Textarea, Input } from '@mantine/core'
import { UseFormReturnType, isNotEmpty } from '@mantine/form'
import type { Supplier } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { vGstin, vPhoneOptional, vPincode, vEmailOptional } from '../lib/formValidators'
import FormSection from './FormSection'
import StateSelect from './StateSelect'
import PincodeField from './PincodeField'

export const SUPPLIER_EMPTY: Omit<Supplier, 'id'> = {
  name: '', gstin: '', pan: '', phone: '', email: '', address: '', city: '', state: '', pincode: ''
}

// Shared useForm() config for both the full Suppliers page form and the inline edit modal, so the
// two consumers can never drift out of sync with each other (validation rules, validateInputOnBlur,
// etc. — whatever is here applies identically to both).
export const supplierFormOptions = {
  mode: 'controlled' as const,
  initialValues: SUPPLIER_EMPTY,
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
}

export function SupplierFields({ form }: {
  form: UseFormReturnType<Omit<Supplier, 'id'>>
}) {
  return (
    <>
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
          onChange={e => form.setFieldValue('phone', e.currentTarget.value.replace(/D/g, '').slice(0, 10))} />
        <TextInput label="Email" placeholder="name@company.com" {...form.getInputProps('email')} />
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
    </>
  )
}
