import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Sale, Purchase, LedgerRow, Settings } from '@shared/types'
import KpiCard from '../components/KpiCard'
import PageHeader from '../components/PageHeader'
import { formatINR, today } from '../lib/format'

export default function Dashboard() {
  const nav = useNavigate()
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      setSales(await window.api.listSales())
      setPurchases(await window.api.listPurchases())
      setLedger(await window.api.stockLedger())
      setSettings(await window.api.getSettings())
    } catch (e: any) {
      setError('Could not load dashboard: ' + (e.message ?? e))
    }
  })() }, [])

  const month = today().slice(0, 7)
  const created = sales.filter(s => s.status === 'created')
  const salesThisMonth = created.filter(s => (s.invoice_date ?? '').startsWith(month))
  const salesTotal = salesThisMonth.reduce((a, s) => a + s.total_invoice_amount, 0)
  const stockOnHand = ledger.reduce((a, r) => a + r.balance_kg, 0)
  const pendingSales = created.filter(s => s.payment_status === 'pending')
  const pendingPurchases = purchases.filter(p => p.payment_status === 'pending')
  const low = settings?.low_stock_threshold ?? 0
  const lowLots = ledger.filter(r => r.balance_kg < low)

  return (
    <div>
      <PageHeader title={`Welcome${settings?.seller_name ? `, ${settings.seller_name}` : ''}`} />
      {error && <p className="error">{error}</p>}
      <p style={{ color: 'var(--muted)' }}>{today()}</p>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="primary" style={{ fontSize: 22, padding: '18px 28px' }} onClick={() => nav('/sales/new')}>New sale</button>
        <button style={{ fontSize: 22, padding: '18px 28px' }} onClick={() => nav('/purchases')}>New purchase</button>
      </div>
      <div className="row">
        <KpiCard label="Sales this month" value={formatINR(salesTotal)} />
        <KpiCard label="Stock on hand" value={`${stockOnHand} kg`} />
        <KpiCard label="Payments pending (sales)" value={String(pendingSales.length)} />
        <KpiCard label="Payments pending (purchases)" value={String(pendingPurchases.length)} />
      </div>
      <div className="panel">
        <h2>Low stock</h2>
        {lowLots.length === 0 ? <p>Nothing below {low} kg.</p> :
          <ul>{lowLots.map(r => <li key={r.purchase_id}>{r.our_code} ({r.hsn_code}) — {r.balance_kg} kg</li>)}</ul>}
      </div>
      <div className="panel">
        <h2>Pending sales payments</h2>
        {pendingSales.length === 0 ? <p>All settled.</p> :
          <ul>{pendingSales.map(s => <li key={s.id}>{s.invoice_number} — {s.buyer_name} — {formatINR(s.total_invoice_amount)}</li>)}</ul>}
      </div>
    </div>
  )
}
