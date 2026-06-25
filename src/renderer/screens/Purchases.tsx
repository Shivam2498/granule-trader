import { Fragment, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, Button, Alert, Badge, Group, Table } from '@mantine/core'
import type { Purchase } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { formatINR } from '../lib/format'
import { groupByMonth, monthLabel } from '../lib/group'
import { useFY } from '../fy'

export default function Purchases() {
  const nav = useNavigate()
  const { fy } = useFY()
  const [list, setList] = useState<Purchase[]>([])
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listPurchases(fy)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [fy])
  async function remove(id: number) {
    setError('')
    if (!confirm('Delete this purchase? Stock will be recalculated.')) return
    try { await window.api.deletePurchase(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title={`Purchases · ${fy}`} action={<Button onClick={() => nav('/purchases/new')}>+ Add purchase</Button>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <ListTable head={<><Table.Th>Code</Table.Th><Table.Th>Date</Table.Th><Table.Th>Supplier</Table.Th><Table.Th>HSN</Table.Th><Table.Th ta="right">Qty</Table.Th><Table.Th ta="right">Remaining</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Payment</Table.Th><Table.Th /></>}>
          {groupByMonth(list, p => p.invoice_date).map(g => (
            <Fragment key={g.key}>
              <Table.Tr>
                <Table.Td colSpan={9} bg="var(--mantine-color-gray-1)" fw={700}>
                  {`${monthLabel(g.key)} — ${g.items.reduce((sum, p) => sum + p.qty_kg, 0)} kg · ${formatINR(g.items.reduce((sum, p) => sum + p.total_invoice_amount, 0))}`}
                </Table.Td>
              </Table.Tr>
              {g.items.map(p => (
                <Table.Tr key={p.id}>
                  <Table.Td>{p.our_code}</Table.Td><Table.Td>{p.invoice_date}</Table.Td><Table.Td>{p.party}</Table.Td><Table.Td>{p.hsn_code}</Table.Td>
                  <Table.Td ta="right">{p.qty_kg}</Table.Td><Table.Td ta="right">{p.qty_remaining_kg}</Table.Td><Table.Td ta="right">{formatINR(p.total_invoice_amount)}</Table.Td>
                  <Table.Td><Badge color={p.payment_status === 'done' ? 'green' : 'orange'}>{p.payment_status}</Badge></Table.Td>
                  <Table.Td>
                    <Group gap="xs" justify="flex-end">
                      <Button variant="subtle" size="compact-sm" onClick={() => nav(`/purchases/edit/${p.id}`)}>Edit</Button>
                      <Button variant="subtle" color="red" size="compact-sm" onClick={() => remove(p.id)}>Delete</Button>
                    </Group>
                  </Table.Td>
                </Table.Tr>))}
            </Fragment>
          ))}
          {list.length === 0 && <Table.Tr><Table.Td colSpan={9} c="dimmed">No purchases yet.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
