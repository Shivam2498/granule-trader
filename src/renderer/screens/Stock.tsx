import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, Button, Alert, Group, Table, Text } from '@mantine/core'
import type { LedgerRow, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import InventoryAgingTable from '../components/dashboard/InventoryAgingTable'
import { inventoryAging } from '../lib/dashboard'
import { today, formatDate } from '../lib/format'

export default function Stock() {
  const nav = useNavigate()
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings())
      setRows(await window.api.stockLedger())
    } catch (e: any) { setError(e.message ?? String(e)) } finally { setLoaded(true) }
  })() }, [])
  const low = settings?.low_stock_threshold ?? 0
  const processedRows = (() => {
    let lastHsn = ''; let running = 0
    return rows.map(r => {
      if (r.hsn_code !== lastHsn) { lastHsn = r.hsn_code; running = 0 }
      running += r.balance_kg
      return { ...r, running }
    })
  })()
  return (
    <div>
      <PageHeader title="Stock" action={<Group gap="sm">
        <Button variant="default" onClick={() => nav('/sales/new')}>New sale from stock</Button>
        <Button onClick={() => nav('/stock/adjust')}>Adjust stock</Button>
      </Group>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Text c="dimmed" mb="md">Current stock on hand — all years (stock carries forward across financial years).</Text>
      <Paper withBorder p="lg" radius="md">
        <ListTable head={<><Table.Th>HSN</Table.Th><Table.Th>Lot</Table.Th><Table.Th>Date</Table.Th><Table.Th>Supplier</Table.Th><Table.Th ta="right">In</Table.Th><Table.Th ta="right">Consumed</Table.Th><Table.Th ta="right">Balance</Table.Th><Table.Th ta="right">Running</Table.Th></>}>
          {processedRows.map(r => {
            const isLow = r.balance_kg < low
            return (
              <Table.Tr key={r.purchase_id} bg={isLow ? 'orange.0' : undefined}>
                <Table.Td>{r.hsn_code}</Table.Td><Table.Td>{r.our_code}</Table.Td><Table.Td>{formatDate(r.invoice_date)}</Table.Td><Table.Td>{r.party}</Table.Td>
                <Table.Td ta="right">{r.qty_kg}</Table.Td><Table.Td ta="right">{r.consumed_kg}</Table.Td><Table.Td ta="right">{r.balance_kg}{isLow ? ' ⚠' : ''}</Table.Td><Table.Td ta="right">{r.running}</Table.Td>
              </Table.Tr>)
          })}
          {loaded && rows.length === 0 && <Table.Tr><Table.Td colSpan={8} c="dimmed">No stock on hand.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>

      {rows.length > 0 && (
        <div style={{ marginTop: 'var(--mantine-spacing-md)' }}>
          <InventoryAgingTable buckets={inventoryAging(rows, today())} />
        </div>
      )}
    </div>
  )
}
