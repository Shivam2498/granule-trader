import { useEffect, useState } from 'react'
import { Paper, Title, TextInput, Textarea, Input, Button, Group, SimpleGrid, Table } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Settings as S, HsnProduct } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
import MoneyInput from '../components/MoneyInput'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'
import ListTable from '../components/ListTable'

export default function Settings() {
  const form = useForm<S>({
    mode: 'controlled',
    initialValues: {} as S,
    validate: {
      seller_name: isNotEmpty('Enter the business name.'),
      seller_gstin: vGstin,
      seller_phone: vPhone,
      home_state: isNotEmpty('Choose the home state.'),
      seller_pincode: (v) => !v ? null : vPincode(v)
    }
  })
  const [loaded, setLoaded] = useState(false)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [newHsn, setNewHsn] = useState<HsnProduct>({ hsn_code: '', description: '', gst_rate: 18 })

  async function reload() {
    const settings = await window.api.getSettings()
    form.setValues(settings); setLoaded(true)
    setHsn(await window.api.listHsn())
  }
  useEffect(() => { reload() }, [])
  if (!loaded) return <h1>Settings</h1>

  async function save(values: S) { await window.api.saveSettings(values); notifications.show({ message: 'Saved.', color: 'green' }) }
  async function backup() { const p = await window.api.backupNow(); notifications.show({ message: `Backup written: ${p}`, color: 'green' }) }
  async function addHsn() {
    if (!newHsn.hsn_code.trim()) return
    await window.api.upsertHsn(newHsn); setNewHsn({ hsn_code: '', description: '', gst_rate: 18 }); reload()
  }

  return (
    <div>
      <h1>Settings</h1>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Title order={2} mb="sm">Business</Title>
        <SimpleGrid cols={3} mb="md">
          <TextInput label="Business name" {...form.getInputProps('seller_name')} />
          <TextInput label="GSTIN" {...form.getInputProps('seller_gstin')}
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
          <TextInput label="Mobile"
            value={form.values.seller_phone}
            onChange={e => form.setFieldValue('seller_phone', e.currentTarget.value.replace(/\D/g, '').slice(0, 10))}
            error={form.errors.seller_phone} />
          <Input.Wrapper label="Home state (tax)" error={form.errors.home_state}>
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
        <Group>
          <Button onClick={() => form.onSubmit(save)()}>Save settings</Button>
          <Button variant="default" onClick={backup}>Backup now</Button>
        </Group>
      </Paper>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Title order={2} mb="sm">Products (HSN)</Title>
        <ListTable head={<><Table.Th>HSN</Table.Th><Table.Th>Description</Table.Th><Table.Th>GST %</Table.Th></>}>
          {hsn.map(h => (
            <Table.Tr key={h.hsn_code}>
              <Table.Td>{h.hsn_code}</Table.Td>
              <Table.Td>{h.description}</Table.Td>
              <Table.Td>{h.gst_rate}</Table.Td>
            </Table.Tr>
          ))}
          {hsn.length === 0 && <Table.Tr><Table.Td colSpan={3} c="dimmed">No products yet.</Table.Td></Table.Tr>}
        </ListTable>
        <Group mt="md" align="flex-end">
          <TextInput label="HSN code" value={newHsn.hsn_code} onChange={e => setNewHsn({ ...newHsn, hsn_code: e.currentTarget.value })} />
          <TextInput label="Description" style={{ flex: 1 }} value={newHsn.description} onChange={e => setNewHsn({ ...newHsn, description: e.currentTarget.value })} />
          <Input.Wrapper label="GST %">
            <MoneyInput value={newHsn.gst_rate} onChange={n => setNewHsn({ ...newHsn, gst_rate: n })} />
          </Input.Wrapper>
          <Button onClick={addHsn}>Add / update</Button>
        </Group>
      </Paper>
    </div>
  )
}
