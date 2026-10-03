import { TextInput, Textarea, Checkbox, Input } from '@mantine/core'
import { UseFormReturnType, isNotEmpty } from '@mantine/form'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { vGstin, vPhoneOptional, vPincode, vEmailOptional } from '../lib/formValidators'
import FormSection from './FormSection'
import StateSelect from './StateSelect'
import PincodeField from './PincodeField'

export const CUSTOMER_EMPTY: Omit<Customer, 'id'> = {
  name: '', gstin: '', pan: '', phone: '', email: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

// Shared useForm() config for both the full Customers page form and the inline edit modal, so the
// two consumers can never drift out of sync with each other (validation rules, validateInputOnBlur,
// etc. — whatever is here applies identically to both).
export const customerFormOptions = {
  mode: 'controlled' as const,
  initialValues: CUSTOMER_EMPTY,
  validate: {
    name: isNotEmpty('Enter the name.'),
    gstin: vGstin,
    phone: vPhoneOptional,
    email: vEmailOptional,
    billing_city: isNotEmpty('Enter the city.'),
    billing_state: isNotEmpty('Choose the state.'),
    billing_pincode: vPincode,
    billing_address: isNotEmpty('Enter the address.'),
    shipping_address: (v: string, values: Omit<Customer, 'id'>) => values.shipping_same ? null : (v.trim() ? null : 'Enter the shipping address.'),
    shipping_city: (v: string, values: Omit<Customer, 'id'>) => values.shipping_same ? null : (v.trim() ? null : 'Enter the shipping city.'),
    shipping_state: (v: string, values: Omit<Customer, 'id'>) => values.shipping_same ? null : (v.trim() ? null : 'Choose the shipping state.'),
    shipping_pincode: (v: string, values: Omit<Customer, 'id'>) => values.shipping_same ? null : vPincode(v)
  }
}

export function CustomerFields({ form }: {
  form: UseFormReturnType<Omit<Customer, 'id'>>
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
          onChange={e => form.setFieldValue('phone', e.currentTarget.value.replace(/\D/g, '').slice(0, 10))} />
        <TextInput label="Email" placeholder="name@company.com" {...form.getInputProps('email')} />
      </FormSection>
      <FormSection title="Billing address">
        <Input.Wrapper label="Pincode" withAsterisk error={form.errors.billing_pincode}>
          <PincodeField value={form.values.billing_pincode} onChange={v => form.setFieldValue('billing_pincode', v)}
            onResolved={r => { form.setFieldValue('billing_city', r.city); form.setFieldValue('billing_state', r.state) }} />
        </Input.Wrapper>
        <TextInput label="City" withAsterisk {...form.getInputProps('billing_city')} />
        <Input.Wrapper label="State" withAsterisk error={form.errors.billing_state}>
          <StateSelect value={form.values.billing_state} onChange={v => form.setFieldValue('billing_state', v)} />
        </Input.Wrapper>
        <Textarea label="Address" withAsterisk autosize minRows={2} {...form.getInputProps('billing_address')} />
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
    </>
  )
}
