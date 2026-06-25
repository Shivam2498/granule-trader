import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Group, Button, Paper, Title, Text, List, Alert } from '@mantine/core'
import type { Sale, Purchase, LedgerRow, Settings } from '@shared/types'
import KpiCard from '../components/KpiCard'
import PageHeader from '../components/PageHeader'
import { formatINR, today } from '../lib/format'
import { useFY } from '../fy'

export default function Dashboard() {
  const nav = useNavigate()
  const { fy } = useFY()
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      setSales(await window.api.listSales(fy)); setPurchases(await window.api.listPurchases(fy))
      setLedger(await window.api.stockLedger()); setSettings(await window.api.getSettings())
    } catch (e: any) { setError('Could not load dashboard: ' + (e.message ?? e)) }
  })() }, [fy])

  const created = sales.filter(s => s.status === 'created')
  const salesTotal = created.reduce((a, s) => a + s.total_invoice_amount, 0)
  const stockOnHand = ledger.reduce((a, r) => a + r.balance_kg, 0)
  const pendingSales = created.filter(s => s.payment_status === 'pending')
  const pendingPurchases = purchases.filter(p => p.payment_status === 'pending')
  const low = settings?.low_stock_threshold ?? 0
  const lowLots = ledger.filter(r => r.balance_kg < low)

  return (
    <div>
      <PageHeader title={`Welcome${settings?.seller_name ? `, ${settings.seller_name}` : ''}`} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Text c="dimmed" mb="md">{today()}</Text>
      <Group mb="lg">
        <Button size="lg" onClick={() => nav('/sales/new')}>New sale</Button>
        <Button size="lg" variant="default" onClick={() => nav('/purchases/new')}>New purchase</Button>
      </Group>
      <Group align="stretch" mb="lg">
        <KpiCard label={`Sales · ${fy}`} value={formatINR(salesTotal)} />
        <KpiCard label="Stock on hand" value={`${stockOnHand} kg`} />
        <KpiCard label="Payments pending (sales)" value={String(pendingSales.length)} />
        <KpiCard label="Payments pending (purchases)" value={String(pendingPurchases.length)} />
      </Group>
      <Paper withBorder p="lg" radius="md" mb="md">
        <Title order={2} mb="sm">Low stock</Title>
        {lowLots.length === 0 ? <Text>Nothing below {low} kg.</Text> :
          <List>{lowLots.map(r => <List.Item key={r.purchase_id}>{r.our_code} ({r.hsn_code}) — {r.balance_kg} kg</List.Item>)}</List>}
      </Paper>
      <Paper withBorder p="lg" radius="md">
        <Title order={2} mb="sm">Pending sales payments</Title>
        {pendingSales.length === 0 ? <Text>All settled.</Text> :
          <List>{pendingSales.map(s => <List.Item key={s.id}>{s.invoice_number} — {s.buyer_name} — {formatINR(s.total_invoice_amount)}</List.Item>)}</List>}
      </Paper>
    </div>
  )
}
