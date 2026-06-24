import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LedgerRow, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'

export default function Stock() {
  const nav = useNavigate()
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { (async () => {
    try { setSettings(await window.api.getSettings()); setRows(await window.api.stockLedger()) } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [])
  const low = settings?.low_stock_threshold ?? 0
  let lastHsn = ''; let running = 0
  return (
    <div>
      <PageHeader title="Stock" action={<>
        <button onClick={() => nav('/sales/new')}>New sale from stock</button>{' '}
        <button className="primary" onClick={() => nav('/stock/adjust')}>Adjust stock</button>
      </>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>HSN</th><th>Lot</th><th>Date</th><th>Supplier</th><th className="num">In</th><th className="num">Consumed</th><th className="num">Balance</th><th className="num">Running</th></tr></thead>
          <tbody>{rows.map(r => {
            if (r.hsn_code !== lastHsn) { lastHsn = r.hsn_code; running = 0 }
            running += r.balance_kg
            const isLow = r.balance_kg < low
            return (
              <tr key={r.purchase_id} style={isLow ? { background: 'var(--warn-bg)' } : undefined}>
                <td>{r.hsn_code}</td><td>{r.our_code}</td><td>{r.invoice_date}</td><td>{r.party}</td>
                <td className="num">{r.qty_kg}</td><td className="num">{r.consumed_kg}</td><td className="num">{r.balance_kg}{isLow ? ' ⚠' : ''}</td><td className="num">{running}</td>
              </tr>)
          })}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No stock on hand.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
