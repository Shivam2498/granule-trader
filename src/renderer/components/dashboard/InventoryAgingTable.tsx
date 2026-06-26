import { useNavigate } from 'react-router-dom'
import { Paper, Title, Table } from '@mantine/core'
import type { AgeBucket } from '../../lib/dashboard'
import { formatINR } from '../../lib/format'

export default function InventoryAgingTable({ buckets }: { buckets: AgeBucket[] }) {
  const nav = useNavigate()
  return (
    <Paper withBorder p="lg" radius="md" mb="md">
      <Title order={3} mb="md">Inventory aging — capital tied up</Title>
      <Table highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Age</Table.Th><Table.Th ta="right">Qty (kg)</Table.Th><Table.Th ta="right">Value</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {buckets.map(b => (
            <Table.Tr key={b.bucket} style={{ cursor: 'pointer' }} onClick={() => nav('/stock')}>
              <Table.Td>{b.bucket} days</Table.Td>
              <Table.Td ta="right">{Math.round(b.kg)}</Table.Td>
              <Table.Td ta="right">{formatINR(b.value)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  )
}
