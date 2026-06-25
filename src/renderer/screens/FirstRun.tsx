import { useState } from 'react'
import {
  Container, Paper, Title, Divider, Group, TextInput, Textarea,
  Button, Alert, SimpleGrid, Input
} from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { deriveInvoicePrefix, panFromGstin } from '@shared/validation'
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

export default function FirstRun({ onDone }: { onDone: () => void }) {
  const [prefixEdited, setPrefixEdited] = useState(false)
  const [error, setError] = useState('')

  const form = useForm({
    mode: 'controlled',
    initialValues: { folder: '', name: '', prefix: '', gstin: '', pan: '', mobile: '', homeState: '', address: '', city: '', pincode: '' },
    validate: {
      folder: (v) => v ? null : 'Choose a data folder.',
      name: isNotEmpty('Enter the business name.'),
      prefix: isNotEmpty('Enter the invoice prefix.'),
      mobile: vPhone,
      gstin: vGstin,
      homeState: isNotEmpty('Choose the home state.'),
      pincode: (v) => !v ? null : vPincode(v)
    }
  })

  async function pick() { const f = await window.api.chooseDataFolder(); if (f) form.setFieldValue('folder', f) }

  function setBusinessName(v: string) {
    form.setFieldValue('name', v)
    if (!prefixEdited) form.setFieldValue('prefix', deriveInvoicePrefix(v))
  }

  async function start(v: typeof form.values) {
    setError('')
    try {
      await window.api.saveSettings({
        seller_name: v.name.trim(), seller_gstin: v.gstin.trim().toUpperCase(), seller_pan: v.pan.trim().toUpperCase(),
        seller_phone: v.mobile.trim(), seller_address: v.address.trim(),
        seller_city: v.city.trim(), seller_pincode: v.pincode.trim(), home_state: v.homeState,
        invoice_prefix: v.prefix.trim().toUpperCase()
      })
      onDone()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <Container size="sm" py="xl">
      <Title order={1} ta="center">Welcome to Granule Trader</Title>
      <p style={{ textAlign: 'center', marginTop: 4, color: 'var(--mantine-color-dimmed)' }}>
        A one-time setup of your business details.
      </p>
      {error && <Alert color="red" mb="md">{error}</Alert>}

      <Paper withBorder p="xl" radius="md">
        <Title order={3}>Data file</Title>
        <Divider mb="md" />
        <Group align="flex-start">
          <TextInput
            style={{ flex: 1 }}
            disabled
            value={form.values.folder}
            placeholder="Choose a folder for your data file…"
            error={form.errors.folder}
          />
          <Button onClick={pick}>Choose…</Button>
        </Group>
        <p style={{ fontSize: 14, color: 'var(--mantine-color-dimmed)', marginTop: 8 }}>
          A cloud-synced folder (Dropbox/Drive/iCloud) lets a second computer use the same data — open it on one computer at a time.
        </p>

        <Title order={3} mt="lg">Your business</Title>
        <Divider mb="md" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Business name"
            withAsterisk
            value={form.values.name}
            onChange={e => setBusinessName(e.currentTarget.value)}
            placeholder="e.g. Ramaxton Plastocrafts"
            error={form.errors.name}
            style={{ gridColumn: 'span 2' }}
          />
          <TextInput
            label="Invoice prefix (auto from name, editable)"
            withAsterisk
            value={form.values.prefix}
            onChange={e => { form.setFieldValue('prefix', e.currentTarget.value.toUpperCase()); setPrefixEdited(true) }}
            error={form.errors.prefix}
          />
          <TextInput
            label="Mobile"
            withAsterisk
            value={form.values.mobile}
            onChange={e => form.setFieldValue('mobile', e.currentTarget.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10 digits"
            error={form.errors.mobile}
          />
          <TextInput
            label="GSTIN"
            withAsterisk
            value={form.values.gstin}
            onChange={e => { const v = e.currentTarget.value.toUpperCase(); form.setFieldValue('gstin', v); form.setFieldValue('pan', panFromGstin(v)) }}
            placeholder="24ABCDE1234F1Z5"
            error={form.errors.gstin}
          />
          <TextInput label="PAN (from GSTIN)" disabled value={form.values.pan} placeholder="from GSTIN" />
          <Input.Wrapper
            label="Pincode"
            error={form.errors.pincode}
          >
            <PincodeField
              value={form.values.pincode}
              onChange={v => form.setFieldValue('pincode', v)}
              onResolved={r => { form.setFieldValue('city', r.city); form.setFieldValue('homeState', r.state) }}
            />
          </Input.Wrapper>
          <TextInput
            label="City"
            value={form.values.city}
            onChange={e => form.setFieldValue('city', e.currentTarget.value)}
          />
          <Textarea
            label="Street address"
            autosize
            minRows={2}
            value={form.values.address}
            onChange={e => form.setFieldValue('address', e.currentTarget.value)}
            style={{ gridColumn: 'span 2' }}
          />
          <Input.Wrapper label="Home state (for tax)" withAsterisk error={form.errors.homeState}>
            <StateSelect value={form.values.homeState} onChange={v => form.setFieldValue('homeState', v)} />
          </Input.Wrapper>
        </SimpleGrid>

        <Group justify="flex-end" mt="md">
          <Button onClick={() => form.onSubmit(start)()}>Start using Granule Trader</Button>
        </Group>
      </Paper>
    </Container>
  )
}
