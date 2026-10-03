import { TextInput, Textarea, Input } from '@mantine/core'
import { UseFormReturnType } from '@mantine/form'
import type { Supplier } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import FormSection from './FormSection'
import StateSelect from './StateSelect'
import PincodeField from './PincodeField'

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
