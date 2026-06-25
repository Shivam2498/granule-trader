import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, TextInput, Button, Alert, Group } from '@mantine/core'
import type { Customer } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { Table } from '@mantine/core'

export default function Customers() {
  const nav = useNavigate()
  const [list, setList] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listCustomers(search || undefined)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [search])
  async function remove(id: number) {
    if (!confirm('Delete this customer?')) return
    try { await window.api.deleteCustomer(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Customers" action={<Button onClick={() => nav('/customers/new')}>+ Add customer</Button>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <TextInput placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.currentTarget.value)} maw={380} mb="md" />
        <ListTable head={<><Table.Th>Name</Table.Th><Table.Th>GSTIN</Table.Th><Table.Th>City</Table.Th><Table.Th>State</Table.Th><Table.Th /></>}>
          {list.map(c => (
            <Table.Tr key={c.id}>
              <Table.Td>{c.name}</Table.Td><Table.Td>{c.gstin}</Table.Td><Table.Td>{c.billing_city}</Table.Td><Table.Td>{c.billing_state}</Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button variant="subtle" size="compact-sm" onClick={() => nav(`/customers/edit/${c.id}`)}>Edit</Button>
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => remove(c.id)}>Delete</Button>
                </Group>
              </Table.Td>
            </Table.Tr>))}
          {list.length === 0 && <Table.Tr><Table.Td colSpan={5} c="dimmed">No customers yet.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
