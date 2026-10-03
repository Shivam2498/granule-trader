import { TextInput, Textarea, Checkbox, Input } from '@mantine/core'
import { UseFormReturnType } from '@mantine/form'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { vGstin, vPhoneOptional, vPincode, vEmailOptional } from '../lib/formValidators'
import FormSection from './FormSection'
import StateSelect from './StateSelect'
import PincodeField from './PincodeField'

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
          onChange={e => form.setFieldValue('phone', e.currentTarget.value.replace(/D/g, '').slice(0, 10))} />
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
