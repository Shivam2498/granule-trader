import { useEffect, useState } from 'react'
import { Paper, Title, TextInput, Button, Group, Input, Table, Text, Modal } from '@mantine/core'
import type { HsnProduct } from '@shared/types'
import ListTable from './ListTable'
import MoneyInput from './MoneyInput'

const BLANK: HsnProduct = { hsn_code: '', description: '', gst_rate: 18 }

export default function HsnEditor() {
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [draft, setDraft] = useState<HsnProduct>(BLANK)
  const [editing, setEditing] = useState<string | null>(null)   // the code being edited, null in add mode
  const [confirming, setConfirming] = useState<HsnProduct | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Refresh only this section's list. Calling Settings' reload() here would reset the
  // business form above and silently discard the user's unsaved edits.
  async function refresh() { setHsn(await window.api.listHsn()) }
  useEffect(() => { refresh() }, [])

  function startEdit(h: HsnProduct) { setEditing(h.hsn_code); setDraft({ ...h }); setError(null) }
  function cancel() { setEditing(null); setDraft(BLANK); setError(null) }

  async function save() {
    const code = draft.hsn_code.trim()
    if (!code) { setError('Enter an HSN code.'); return }
    try {
      await window.api.upsertHsn({ ...draft, hsn_code: code, description: draft.description.trim() })
      cancel()
      await refresh()
    } catch (e) {
      setError(`Couldn't save this product: ${(e as Error).message}`)
    }
  }

  async function confirmDelete() {
    const target = confirming
    if (!target) return
    setConfirming(null)
    try {
      await window.api.deleteHsn(target.hsn_code)
      if (editing === target.hsn_code) cancel()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Paper withBorder p="lg" radius="md" mb="md">
      <Title order={2} mb="sm">Products (HSN)</Title>

      <ListTable head={<><Table.Th>HSN</Table.Th><Table.Th>Description</Table.Th><Table.Th>GST %</Table.Th><Table.Th /></>}>
        {hsn.map(h => (
          <Table.Tr key={h.hsn_code}>
            <Table.Td>{h.hsn_code}</Table.Td>
            <Table.Td>{h.description}</Table.Td>
            <Table.Td>{h.gst_rate}</Table.Td>
            <Table.Td>
              <Group gap="xs" justify="flex-end" wrap="nowrap">
                <Button size="xs" variant="default" onClick={() => startEdit(h)}>Edit</Button>
                <Button size="xs" variant="subtle" color="red" onClick={() => { setError(null); setConfirming(h) }}>Delete</Button>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
        {hsn.length === 0 && <Table.Tr><Table.Td colSpan={4} c="dimmed">No products yet.</Table.Td></Table.Tr>}
      </ListTable>

      <Group mt="md" align="flex-end">
        <TextInput label="HSN code" disabled={editing !== null} value={draft.hsn_code}
          onChange={e => setDraft({ ...draft, hsn_code: e.currentTarget.value })} />
        <TextInput label="Description" style={{ flex: 1 }} value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.currentTarget.value })} />
        <Input.Wrapper label="GST %">
          <MoneyInput value={draft.gst_rate} onChange={n => setDraft({ ...draft, gst_rate: n })} />
        </Input.Wrapper>
        <Button onClick={save}>{editing ? 'Save changes' : 'Add'}</Button>
        {editing && <Button variant="default" onClick={cancel}>Cancel</Button>}
      </Group>

      {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
      <Text c="dimmed" size="sm" mt="sm">
        Changing a GST % applies to new sales only — invoices already made keep the rate they were issued with.
      </Text>

      <Modal opened={confirming !== null} onClose={() => setConfirming(null)} title="Delete this product?" centered>
        <Text mb="lg">
          {confirming ? `${confirming.hsn_code}${confirming.description ? ` — ${confirming.description}` : ''} will be removed from the product list.` : ''}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirming(null)}>Keep it</Button>
          <Button color="red" onClick={confirmDelete}>Delete product</Button>
        </Group>
      </Modal>
    </Paper>
  )
}
