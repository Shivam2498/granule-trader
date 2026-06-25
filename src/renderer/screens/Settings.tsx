import { useEffect, useState } from 'react'
import { Paper, Title, TextInput, Textarea, Input, Button, Group, SimpleGrid } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import type { Settings as S, HsnProduct } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'
import ListTable from '../components/ListTable'
import { Table } from '@mantine/core'

export default function Settings() {
  const [s, setS] = useState<S | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [newHsn, setNewHsn] = useState<HsnProduct>({ hsn_code: '', description: '', gst_rate: 18 })

  async function reload() { setS(await window.api.getSettings()); setHsn(await window.api.listHsn()) }
  useEffect(() => { reload() }, [])
  if (!s) return <h1>Settings</h1>
  const set = (patch: Partial<S>) => setS({ ...s, ...patch })

  async function save() { await window.api.saveSettings(s!); notifications.show({ message: 'Saved.', color: 'green' }) }
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
          <TextInput label="Business name" value={s.seller_name} onChange={e => set({ seller_name: e.currentTarget.value })} />
          <TextInput label="GSTIN" value={s.seller_gstin} onChange={e => set({ seller_gstin: e.currentTarget.value })} />
          <TextInput label="PAN" value={s.seller_pan} onChange={e => set({ seller_pan: e.currentTarget.value })} />
        </SimpleGrid>
        <Group grow mb="md">
          <Input.Wrapper label="Pincode">
            <PincodeField value={s.seller_pincode} onChange={v => set({ seller_pincode: v })}
              onResolved={r => set({ seller_city: r.city, home_state: r.state })} />
          </Input.Wrapper>
          <TextInput label="City" value={s.seller_city} onChange={e => set({ seller_city: e.currentTarget.value })} />
        </Group>
        <Textarea label="Address" autosize minRows={2} value={s.seller_address} onChange={e => set({ seller_address: e.currentTarget.value })} mb="md" />
        <SimpleGrid cols={3} mb="md">
          <TextInput label="Mobile" value={s.seller_phone} onChange={e => set({ seller_phone: e.currentTarget.value.replace(/\D/g,'').slice(0,10) })} />
          <Input.Wrapper label="Home state (tax)">
            <StateSelect value={s.home_state} onChange={v => set({ home_state: v })} />
          </Input.Wrapper>
          <TextInput label="Invoice prefix" value={s.invoice_prefix} onChange={e => set({ invoice_prefix: e.currentTarget.value })} />
        </SimpleGrid>
        <SimpleGrid cols={3} mb="md">
          <Input.Wrapper label="Default GST rate %">
            <MoneyInput value={s.default_gst_rate} onChange={n => set({ default_gst_rate: n })} />
          </Input.Wrapper>
          <Input.Wrapper label="Low-stock threshold (kg)">
            <MoneyInput value={s.low_stock_threshold} onChange={n => set({ low_stock_threshold: n })} />
          </Input.Wrapper>
          <Input.Wrapper label="Backups to keep">
            <MoneyInput value={s.backups_to_keep} onChange={n => set({ backups_to_keep: n })} />
          </Input.Wrapper>
        </SimpleGrid>
        <TextInput label="Data folder" disabled value={s.data_folder} mb="md" />
        <Group>
          <Button onClick={save}>Save settings</Button>
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
