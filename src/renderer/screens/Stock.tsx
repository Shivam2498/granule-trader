import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LedgerRow, Settings } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import { today } from '../lib/format'

export default function Stock() {
  const nav = useNavigate()
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [adj, setAdj] = useState<{ purchase_id: number | null; qty_kg: number; reason: string; date: string }>(
    { purchase_id: null, qty_kg: 0, reason: '', date: today() })
  const [error, setError] = useState('')

  async function reload() { setRows(await window.api.stockLedger()) }
  useEffect(() => { (async () => { setSettings(await window.api.getSettings()); reload() })() }, [])

  async function saveAdj() {
    setError('')
    if (!adj.purchase_id || adj.qty_kg <= 0) { setError('Choose a lot and a quantity.'); return }
    try {
      await window.api.createStockAdjustment({ purchase_id: adj.purchase_id, qty_kg: adj.qty_kg, reason: adj.reason, date: adj.date })
      setAdj({ purchase_id: null, qty_kg: 0, reason: '', date: today() }); reload()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  // running balance per HSN group
  let lastHsn = ''
  let running = 0
  const low = settings?.low_stock_threshold ?? 0

  return (
    <div>
      <h1>Stock</h1>
      <div className="panel"><button className="primary" onClick={() => nav('/sales/new')}>New sale from stock</button></div>
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <h2>Stock statement (per lot)</h2>
        <table>
          <thead><tr><th>HSN</th><th>Lot</th><th>Date</th><th>Supplier</th><th>In</th><th>Consumed</th><th>Balance</th><th>Running</th></tr></thead>
          <tbody>{rows.map(r => {
            if (r.hsn_code !== lastHsn) { lastHsn = r.hsn_code; running = 0 }
            running += r.balance_kg
            const isLow = r.balance_kg < low
            return (
              <tr key={r.purchase_id} style={isLow ? { background: '#fff3e0' } : undefined}>
                <td>{r.hsn_code}</td><td>{r.our_code}</td><td>{r.invoice_date}</td><td>{r.party}</td>
                <td>{r.qty_kg}</td><td>{r.consumed_kg}</td><td>{r.balance_kg}{isLow ? ' ⚠' : ''}</td><td>{running}</td>
              </tr>)
          })}</tbody>
        </table>
        {rows.length === 0 && <p>No stock on hand.</p>}
      </div>

      <div className="panel">
        <h2>Stock adjustment</h2>
        <div className="row">
          <div className="field grow"><label>Lot</label>
            <select value={adj.purchase_id ?? ''} onChange={e => setAdj({ ...adj, purchase_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— choose lot —</option>
              {rows.map(r => <option key={r.purchase_id} value={r.purchase_id}>{r.our_code} — {r.balance_kg} kg left</option>)}
            </select>
          </div>
          <div className="field"><label>Quantity removed (kg)</label><MoneyInput value={adj.qty_kg} onChange={n => setAdj({ ...adj, qty_kg: n })} /></div>
          <div className="field"><label>Date</label><input type="date" value={adj.date} onChange={e => setAdj({ ...adj, date: e.target.value })} /></div>
          <div className="field grow"><label>Reason</label><input value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} placeholder="spillage / sample / loss / correction" /></div>
        </div>
        <button onClick={saveAdj}>Record adjustment</button>
      </div>
    </div>
  )
}
