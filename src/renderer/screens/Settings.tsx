import { useEffect, useState } from 'react'
import { Paper, Title, TextInput, Textarea, Input, Button, Group, SimpleGrid, Checkbox, Center, Loader } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Settings as S } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
import MoneyInput from '../components/MoneyInput'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'
import HsnEditor from '../components/HsnEditor'

export default function Settings() {
  const form = useForm<S & { godown_same: boolean }>({
    mode: 'controlled',
    initialValues: {} as S & { godown_same: boolean },
    validate: {
      seller_name: isNotEmpty('Enter the business name.'),
      seller_gstin: vGstin,
      seller_phone: vPhone,
      home_state: isNotEmpty('Choose the home state.'),
      seller_pincode: (v) => !v ? null : vPincode(v),
      seller_godown_address: (v, values) => values.godown_same ? null : (v?.trim() ? null : 'Enter the godown address.'),
      seller_email: isNotEmpty('Enter the email.'),
      bank_name: isNotEmpty('Enter the bank name.'),
      bank_branch: isNotEmpty('Enter the bank branch.'),
      bank_account_no: isNotEmpty('Enter the A/C number.'),
      bank_ifsc: isNotEmpty('Enter the IFSC.'),
    }
  })
  const [loaded, setLoaded] = useState(false)

  async function reload() {
    const settings = await window.api.getSettings()
    const godown = (settings.seller_godown_address ?? '').trim()
    form.setValues({ ...settings, godown_same: !godown || godown === (settings.seller_address ?? '').trim() })
    setLoaded(true)
  }
  useEffect(() => { reload() }, [])
  if (!loaded) return <Center h="60vh"><Loader /></Center>

  async function save(values: S & { godown_same: boolean }) {
    const { godown_same, ...rest } = values
    try {
      await window.api.saveSettings({ ...rest, seller_godown_address: godown_same ? '' : rest.seller_godown_address.trim() })
      notifications.show({ message: 'Saved.', color: 'green' })
    } catch (e) {
      notifications.show({ message: `Couldn't save settings: ${(e as Error).message}`, color: 'red' })
    }
  }
  async function backup() {
    try {
      const p = await window.api.backupNow()
      notifications.show({ message: `Backup written: ${p}`, color: 'green' })
    } catch (e) {
      notifications.show({ message: `Backup failed: ${(e as Error).message}`, color: 'red' })
    }
  }
  return (
    <div>
      <h1>Settings</h1>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Title order={2} mb="sm">Business</Title>
        <SimpleGrid cols={3} mb="md">
          <TextInput label="Business name" withAsterisk {...form.getInputProps('seller_name')} />
          <TextInput label="GSTIN" withAsterisk {...form.getInputProps('seller_gstin')}
            onChange={e => {
              const v = e.currentTarget.value.toUpperCase()
              form.setFieldValue('seller_gstin', v)
              form.setFieldValue('seller_pan', panFromGstin(v))
            }} />
          <TextInput label="PAN (from GSTIN)" disabled value={form.values.seller_pan} />
        </SimpleGrid>
        <Group grow mb="md">
          <Input.Wrapper label="Pincode" error={form.errors.seller_pincode}>
            <PincodeField value={form.values.seller_pincode} onChange={v => form.setFieldValue('seller_pincode', v)}
              onResolved={r => { form.setFieldValue('seller_city', r.city); form.setFieldValue('home_state', r.state) }} />
          </Input.Wrapper>
          <TextInput label="City" {...form.getInputProps('seller_city')} />
        </Group>
        <Textarea label="Address" autosize minRows={2} {...form.getInputProps('seller_address')} mb="md" />
        <SimpleGrid cols={3} mb="md">
          <TextInput label="Mobile" withAsterisk
            value={form.values.seller_phone}
            onChange={e => form.setFieldValue('seller_phone', e.currentTarget.value.replace(/\D/g, '').slice(0, 10))}
            error={form.errors.seller_phone} />
          <Input.Wrapper label="Home state (tax)" withAsterisk error={form.errors.home_state}>
            <StateSelect value={form.values.home_state} onChange={v => form.setFieldValue('home_state', v)} />
          </Input.Wrapper>
          <TextInput label="Invoice prefix" {...form.getInputProps('invoice_prefix')} />
        </SimpleGrid>
        <SimpleGrid cols={3} mb="md">
          <Input.Wrapper label="Default GST rate %">
            <MoneyInput value={form.values.default_gst_rate} onChange={n => form.setFieldValue('default_gst_rate', n)} />
          </Input.Wrapper>
          <Input.Wrapper label="Low-stock threshold (kg)">
            <MoneyInput value={form.values.low_stock_threshold} onChange={n => form.setFieldValue('low_stock_threshold', n)} />
          </Input.Wrapper>
          <Input.Wrapper label="Backups to keep">
            <MoneyInput value={form.values.backups_to_keep} onChange={n => form.setFieldValue('backups_to_keep', n)} />
          </Input.Wrapper>
        </SimpleGrid>
        <TextInput label="Data folder" disabled value={form.values.data_folder} mb="md" />
        <Checkbox label="Godown address is the same as office" mb="sm" {...form.getInputProps('godown_same', { type: 'checkbox' })} />
        {!form.values.godown_same &&
          <Textarea label="Godown address" autosize minRows={2} {...form.getInputProps('seller_godown_address')} mb="md" />}
        <SimpleGrid cols={3} mb="md">
          <TextInput label="UDYAM No. (optional)" {...form.getInputProps('seller_udyam')} />
          <TextInput label="Email" withAsterisk {...form.getInputProps('seller_email')} />
          <TextInput label="Bank name" withAsterisk {...form.getInputProps('bank_name')} />
          <TextInput label="Bank branch" withAsterisk {...form.getInputProps('bank_branch')} />
          <TextInput label="Bank A/C No." withAsterisk {...form.getInputProps('bank_account_no')} />
          <TextInput label="IFSC" withAsterisk {...form.getInputProps('bank_ifsc')} />
        </SimpleGrid>
        <Group>
          <Button onClick={() => form.onSubmit(save)()}>Save settings</Button>
          <Button variant="default" onClick={backup}>Backup now</Button>
        </Group>
      </Paper>

      <HsnEditor />
    </div>
  )
}
