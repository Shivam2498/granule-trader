import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LedgerRow } from '@shared/types'
import type { AdjustmentRow } from '../../main/core/adjustment'
import PageHeader from '../components/PageHeader'
import MoneyInput from '../components/MoneyInput'
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
    if (!adj.purchase_id || adj.qty_kg <= 0) { setError('Choose a lot and a quantity greater than 0.'); return }
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
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <p>A stock adjustment records granules that left your stock <b>without a sale</b>, so your stock figures stay correct. Use it for:</p>
        <ul className="muted" style={{ marginTop: 4 }}>
          <li><b>Spillage / wastage</b> — material spilled or unusable</li>
          <li><b>Sample given</b> — free sample handed to a customer</li>
          <li><b>Loss / damage</b> — stock damaged, lost, or stolen</li>
          <li><b>Correction</b> — fixing a counting mistake</li>
        </ul>
        <div className="notice">This permanently reduces the selected lot's remaining quantity. It does <b>not</b> create an invoice, does <b>not</b> involve a customer, and has <b>no GST effect</b> — it is not a sale. You cannot remove more than the lot's available balance.</div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Record an adjustment</h3>
        <div className="form-grid">
          <div className="field full"><label>Lot</label>
            <select value={adj.purchase_id ?? ''} onChange={e => setAdj({ ...adj, purchase_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— choose lot —</option>
              {lots.map(r => <option key={r.purchase_id} value={r.purchase_id}>{r.our_code} ({r.hsn_code}) — {r.balance_kg} kg left</option>)}
            </select></div>
          <div className="field"><label>Quantity removed (kg)</label><MoneyInput value={adj.qty_kg} onChange={n => setAdj({ ...adj, qty_kg: n })} /></div>
          <div className="field"><label>Date</label><input type="date" value={adj.date} onChange={e => setAdj({ ...adj, date: e.target.value })} /></div>
          <div className="field full"><label>Reason</label>
            <select value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })}>{REASONS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
        </div>
        <div className="form-actions"><button className="primary" onClick={save}>Record adjustment</button></div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Recent adjustments</h3>
        <table>
          <thead><tr><th>Lot</th><th className="num">Qty removed</th><th>Reason</th><th>Date</th><th></th></tr></thead>
          <tbody>{recent.map(a => (
            <tr key={a.id}><td>{a.our_code}</td><td className="num">{a.qty_kg}</td><td>{a.reason}</td><td>{a.date}</td>
              <td className="num"><button className="link danger" onClick={() => undo(a.id)}>Undo</button></td></tr>))}
            {recent.length === 0 && <tr><td colSpan={5} className="muted">No adjustments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
