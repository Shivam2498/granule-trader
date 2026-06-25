import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, Button, Alert, Badge, Group, Table, Text } from '@mantine/core'
import type { Sale } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { formatINR } from '../lib/format'
import { groupByMonth, monthLabel } from '../lib/group'
import { useFY } from '../fy'

export default function Sales() {
  const nav = useNavigate()
  const { fy } = useFY()
  const [list, setList] = useState<Sale[]>([])
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listSales(fy)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [fy])
  async function remove(id: number) {
    setError('')
    if (!confirm('Delete this sale? Stock will be restored.')) return
    try { await window.api.deleteSale(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title={`Sales · ${fy}`} action={<Button onClick={() => nav('/sales/new')}>+ New sale</Button>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <ListTable head={<><Table.Th>Invoice</Table.Th><Table.Th>Date</Table.Th><Table.Th>Buyer</Table.Th><Table.Th ta="right">Qty</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Payment</Table.Th><Table.Th /></>}>
          {groupByMonth(list, s => s.invoice_date).map(g => (
            <Fragment key={g.key}>
              <Table.Tr>
                <Table.Td colSpan={7} bg="var(--mantine-color-gray-1)" fw={700}>
                  {g.key === 'undated' ? 'Reserved' : `${monthLabel(g.key)} — ${g.items.reduce((sum, s) => sum + s.total_qty_kg, 0)} kg · ${formatINR(g.items.reduce((sum, s) => sum + s.total_invoice_amount, 0))}`}
                </Table.Td>
              </Table.Tr>
              {g.items.map(s => s.status === 'reserved' ? (
                <Table.Tr key={s.id}>
                  <Table.Td>{s.invoice_number}</Table.Td><Table.Td colSpan={4}><Text c="dimmed" fs="italic">reserved — blank</Text></Table.Td><Table.Td />
                  <Table.Td><Button variant="subtle" size="compact-sm" onClick={() => nav(`/sales/fill/${s.id}`)}>Fill</Button></Table.Td>
                </Table.Tr>
              ) : (
                <Table.Tr key={s.id}>
                  <Table.Td>{s.invoice_number}</Table.Td><Table.Td>{s.invoice_date}</Table.Td><Table.Td>{s.buyer_name}</Table.Td>
                  <Table.Td ta="right">{s.total_qty_kg}</Table.Td><Table.Td ta="right">{formatINR(s.total_invoice_amount)}</Table.Td>
                  <Table.Td><Badge color={s.payment_status === 'done' ? 'green' : 'orange'}>{s.payment_status}</Badge></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Button variant="subtle" size="compact-sm" onClick={() => nav(`/invoice/${s.id}`)}>Preview / PDF</Button>
                      <Button variant="subtle" color="red" size="compact-sm" onClick={() => remove(s.id)}>Delete</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Fragment>
          ))}
          {list.length === 0 && <Table.Tr><Table.Td colSpan={7} c="dimmed">No sales yet.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
