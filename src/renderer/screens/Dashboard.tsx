import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Group, Button, Alert, Text, SimpleGrid } from '@mantine/core'
import type { Sale, Purchase, LedgerRow, Settings } from '@shared/types'
import KpiCard from '../components/KpiCard'
import PageHeader from '../components/PageHeader'
import ActionCenter from '../components/dashboard/ActionCenter'
import TrendChart from '../components/dashboard/TrendChart'
import StockDonut from '../components/dashboard/StockDonut'
import { formatINR, today } from '../lib/format'
import {
  monthlyTrend, receivables, payables, gstSnapshot, monthDelta,
  stockByProduct, lowStock, reservedPendingFill
} from '../lib/dashboard'
import { useFY } from '../fy'

export default function Dashboard() {
  const nav = useNavigate()
  const { fy } = useFY()
  const [sales, setSales] = useState<Sale[]>([])
  const [allSales, setAllSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [allPurchases, setAllPurchases] = useState<Purchase[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      setSales(await window.api.listSales(fy)); setPurchases(await window.api.listPurchases(fy))
      setAllSales(await window.api.listSales()); setAllPurchases(await window.api.listPurchases())
      setLedger(await window.api.stockLedger()); setSettings(await window.api.getSettings())
    } catch (e: any) { setError('Could not load dashboard: ' + (e.message ?? e)) }
  })() }, [fy])

  const now = today()
  const trend = monthlyTrend(sales, purchases)
  // Receivables and payables are to-date balances across every year — money owed does not reset in
  // April — while sales and purchases are the current financial year's activity.
  const rec = receivables(allSales, now)
  const pay = payables(allPurchases, now)
  const gst = gstSnapshot(sales, purchases)
  const delta = monthDelta(sales, now)
  const stock = stockByProduct(ledger)
  const lowMaterials = lowStock(ledger, settings?.low_stock_threshold ?? 0)
  const reserved = reservedPendingFill(sales)

  const salesFy = sales.filter(s => s.status === 'created').reduce((a, s) => a + s.total_invoice_amount, 0)
  const purchasesFy = purchases.reduce((a, p) => a + p.total_invoice_amount, 0)
  const stockKg = ledger.reduce((a, r) => a + r.balance_kg, 0)
  const stockValue = stock.reduce((a, s) => a + s.value, 0)
  const deltaText = delta.pct === null ? null
    : <Text span c={delta.pct >= 0 ? 'teal' : 'red'}>{delta.pct >= 0 ? '▲' : '▼'} {Math.abs(delta.pct).toFixed(0)}% vs last month</Text>

  return (
    <div>
      <PageHeader title={`Welcome${settings?.seller_name ? `, ${settings.seller_name}` : ''}`} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Text c="dimmed" mb="md">{now}</Text>
      <Group mb="lg">
        <Button size="lg" onClick={() => nav('/sales/new')}>New sale</Button>
        <Button size="lg" variant="default" onClick={() => nav('/purchases/new')}>New purchase</Button>
      </Group>

      {/* Money in, money out, money owed, money due — everything clicks through to the list behind it. */}
      <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="lg">
        <KpiCard label={`Sales · ${fy}`} value={formatINR(salesFy)} sub={deltaText} onClick={() => nav('/sales')} />
        <KpiCard label={`Purchases · ${fy}`} value={formatINR(purchasesFy)} sub={`${purchases.length} bills`} onClick={() => nav('/purchases')} />
        <KpiCard label="Receivables outstanding" value={formatINR(rec.total)} sub={`${rec.overdue.length} unpaid · to date`} onClick={() => nav('/outstanding')} />
        <KpiCard label="Payables outstanding" value={formatINR(pay.total)} sub={`${pay.due.length} unpaid · to date`} onClick={() => nav('/outstanding')} />
      </SimpleGrid>

      <SimpleGrid cols={{ base: 1, sm: 2 }} mb="lg">
        <KpiCard label="Stock on hand" value={`${stockKg} kg`} sub={formatINR(stockValue)} onClick={() => nav('/stock')} />
        <KpiCard label={`Net GST payable · ${fy}`} value={formatINR(gst.net)} sub={`out ${formatINR(gst.output)} − in ${formatINR(gst.input)}`} />
      </SimpleGrid>

      <ActionCenter dueP={pay.due} overdue={rec.overdue} reserved={reserved} lowMaterials={lowMaterials} />

      {/* Ageing and inventory-ageing detail used to sit here too. It belongs on Stock, not on the
          first screen the owner sees every morning. */}
      <SimpleGrid cols={{ base: 1, md: 2 }} mb="md">
        <TrendChart data={trend} />
        <StockDonut data={stock} />
      </SimpleGrid>
    </div>
  )
}
