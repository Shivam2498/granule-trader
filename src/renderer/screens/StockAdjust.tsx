import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, Text, List, Alert, Select, Input, Button, Table } from '@mantine/core'
import type { LedgerRow } from '@shared/types'
import type { AdjustmentRow } from '../../main/core/adjustment'
import PageHeader from '../components/PageHeader'
import MoneyInput from '../components/MoneyInput'
import DateField from '../components/DateField'
import { today } from '../lib/format'

const REASONS = ['Spillage / wastage', 'Sample given', 'Loss / damage', 'Correction']

export default function StockAdjust() {
  const nav = useNavigate()
  const [lots, setLots] = useState<LedgerRow[]>([])
  const [recent, setRecent] = useState<AdjustmentRow[]>([])
  const [error, setError] = useState('')
  const [adj, setAdj] = useState({ purchase_id: null as number | null, qty_kg: 0, reason: REASONS[0], date: today() })

  async function reload() {
    try { setLots(await window.api.stockLedger()); setRecent(await window.api.listAdjustments()) }
    catch (e: any) { setError(e.message ?? String(e)) }
  }
  useEffect(() => { reload() }, [])

  async function save() {
    setError('')
    if (!adj.purchase_id || adj.qty_kg <= 0) { setError('Please choose a lot and enter a quantity greater than 0.'); return }
    try {
      await window.api.createStockAdjustment({ purchase_id: adj.purchase_id, qty_kg: adj.qty_kg, reason: adj.reason, date: adj.date })
      setAdj({ purchase_id: null, qty_kg: 0, reason: REASONS[0], date: today() }); reload()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }
  async function undo(id: number) {
    if (!confirm('Undo this adjustment? The quantity will be added back to the lot.')) return
    try { await window.api.deleteAdjustment(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <div>
      <PageHeader title="Stock adjustment" back={() => nav('/stock')} />
      {error && <Alert color="red" mb="md">{error}</Alert>}

      <Paper withBorder p="lg" radius="md" mb="md">
        <Text mb="xs">A stock adjustment records granules that left your stock <b>without a sale</b>, so your stock figures stay correct. Use it for:</Text>
        <List mt={4} c="dimmed">
          <List.Item><b>Spillage / wastage</b> — material spilled or unusable</List.Item>
          <List.Item><b>Sample given</b> — free sample handed to a customer</List.Item>
          <List.Item><b>Loss / damage</b> — stock damaged, lost, or stolen</List.Item>
          <List.Item><b>Correction</b> — fixing a counting mistake</List.Item>
        </List>
        <Alert color="orange" variant="light" mb="md" mt="md">
          This permanently reduces the selected lot's remaining quantity. It does <b>not</b> create an invoice, does <b>not</b> involve a customer, and has <b>no GST effect</b> — it is not a sale. You cannot remove more than the lot's available balance.
        </Alert>
      </Paper>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="md">Record an adjustment</Text>
        <Select
          label="Lot"
          data={lots.map(r => ({ value: String(r.purchase_id), label: `${r.our_code} (${r.hsn_code}) — ${r.balance_kg} kg left` }))}
          value={adj.purchase_id ? String(adj.purchase_id) : null}
          onChange={v => setAdj({ ...adj, purchase_id: v ? Number(v) : null })}
          mb="sm"
        />
        <Input.Wrapper label="Quantity removed (kg)" mb="sm">
          <MoneyInput value={adj.qty_kg} onChange={n => setAdj({ ...adj, qty_kg: n })} />
        </Input.Wrapper>
        <Input.Wrapper label="Date" mb="sm">
          <DateField value={adj.date} onChange={d => setAdj({ ...adj, date: d })} />
        </Input.Wrapper>
        <Select
          label="Reason"
          data={REASONS}
          value={adj.reason}
          onChange={v => setAdj({ ...adj, reason: v ?? REASONS[0] })}
          mb="md"
        />
        <Button onClick={save}>Record adjustment</Button>
      </Paper>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="md">Recent adjustments</Text>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Lot</Table.Th>
              <Table.Th ta="right">Qty removed</Table.Th>
              <Table.Th>Reason</Table.Th>
              <Table.Th>Date</Table.Th>
              <Table.Th></Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {recent.map(a => (
              <Table.Tr key={a.id}>
                <Table.Td>{a.our_code}</Table.Td>
                <Table.Td ta="right">{a.qty_kg}</Table.Td>
                <Table.Td>{a.reason}</Table.Td>
                <Table.Td>{a.date}</Table.Td>
                <Table.Td ta="right">
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => undo(a.id)}>Undo</Button>
                </Table.Td>
              </Table.Tr>
            ))}
            {recent.length === 0 && <Table.Tr><Table.Td colSpan={5} c="dimmed">No adjustments yet.</Table.Td></Table.Tr>}
          </Table.Tbody>
        </Table>
      </Paper>
    </div>
  )
}
