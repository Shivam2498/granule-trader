import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, TextInput, Button, Alert, Group, Table } from '@mantine/core'
import type { Supplier } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'

export default function Suppliers() {
  const nav = useNavigate()
  const [list, setList] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  async function reload() { try { setError(''); setList(await window.api.listSuppliers(search || undefined)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [search])
  async function remove(id: number) {
    if (!confirm('Delete this supplier?')) return
    try { await window.api.deleteSupplier(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Suppliers" action={<Button onClick={() => nav('/suppliers/new')}>+ Add supplier</Button>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <TextInput placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.currentTarget.value)} maw={380} mb="md" />
        <ListTable head={<><Table.Th>Name</Table.Th><Table.Th>GSTIN</Table.Th><Table.Th>City</Table.Th><Table.Th>State</Table.Th><Table.Th /></>}>
          {list.map(s => (
            <Table.Tr key={s.id}>
              <Table.Td>{s.name}</Table.Td><Table.Td>{s.gstin}</Table.Td><Table.Td>{s.city}</Table.Td><Table.Td>{s.state}</Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button variant="subtle" size="compact-sm" onClick={() => nav(`/suppliers/edit/${s.id}`)}>Edit</Button>
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => remove(s.id)}>Delete</Button>
                </Group>
              </Table.Td>
            </Table.Tr>))}
          {list.length === 0 && <Table.Tr><Table.Td colSpan={5} c="dimmed">No suppliers yet.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
