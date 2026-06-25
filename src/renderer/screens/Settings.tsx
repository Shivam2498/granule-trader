import { useEffect, useState } from 'react'
import type { Settings as S, HsnProduct } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

export default function Settings() {
  const [s, setS] = useState<S | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [msg, setMsg] = useState('')
  const [newHsn, setNewHsn] = useState<HsnProduct>({ hsn_code: '', description: '', gst_rate: 18 })

  async function reload() { setS(await window.api.getSettings()); setHsn(await window.api.listHsn()) }
  useEffect(() => { reload() }, [])
  if (!s) return <h1>Settings</h1>
  const set = (patch: Partial<S>) => setS({ ...s, ...patch })

  async function save() { await window.api.saveSettings(s!); setMsg('Saved.'); setTimeout(() => setMsg(''), 2000) }
  async function backup() { const p = await window.api.backupNow(); setMsg(`Backup written: ${p}`) }
  async function addHsn() {
    if (!newHsn.hsn_code.trim()) return
    await window.api.upsertHsn(newHsn); setNewHsn({ hsn_code: '', description: '', gst_rate: 18 }); reload()
  }

  return (
    <div>
      <h1>Settings</h1>
      {msg && <p className="ok">{msg}</p>}
      <div className="panel">
        <h2>Business</h2>
        <div className="row">
          <div className="field grow"><label>Business name</label><input value={s.seller_name} onChange={e => set({ seller_name: e.target.value })} /></div>
          <div className="field grow"><label>GSTIN</label><input value={s.seller_gstin} onChange={e => set({ seller_gstin: e.target.value })} /></div>
          <div className="field grow"><label>PAN</label><input value={s.seller_pan} onChange={e => set({ seller_pan: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field"><label>Pincode</label>
            <PincodeField value={s.seller_pincode} onChange={v => set({ seller_pincode: v })}
              onResolved={r => set({ seller_city: r.city, home_state: r.state })} /></div>
          <div className="field grow"><label>City</label>
            <input value={s.seller_city} onChange={e => set({ seller_city: e.target.value })} /></div>
        </div>
        <div className="field"><label>Street address</label><textarea value={s.seller_address} onChange={e => set({ seller_address: e.target.value })} /></div>
        <div className="row">
          <div className="field grow"><label>Mobile</label><input value={s.seller_phone} onChange={e => set({ seller_phone: e.target.value.replace(/\D/g,'').slice(0,10) })} /></div>
          <div className="field grow"><label>Home state (tax)</label><StateSelect value={s.home_state} onChange={v => set({ home_state: v })} /></div>
          <div className="field grow"><label>Invoice prefix</label><input value={s.invoice_prefix} onChange={e => set({ invoice_prefix: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Default GST rate %</label><MoneyInput value={s.default_gst_rate} onChange={n => set({ default_gst_rate: n })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Low-stock threshold (kg)</label><MoneyInput value={s.low_stock_threshold} onChange={n => set({ low_stock_threshold: n })} /></div>
          <div className="field grow"><label>Backups to keep</label><MoneyInput value={s.backups_to_keep} onChange={n => set({ backups_to_keep: n })} /></div>
          <div className="field grow"><label>Data folder</label><input value={s.data_folder} readOnly /></div>
        </div>
        <button className="primary" onClick={save}>Save settings</button>{' '}
        <button onClick={backup}>Backup now</button>
      </div>

      <div className="panel">
        <h2>Products (HSN)</h2>
        <table><thead><tr><th>HSN</th><th>Description</th><th>GST %</th></tr></thead>
          <tbody>{hsn.map(h => <tr key={h.hsn_code}><td>{h.hsn_code}</td><td>{h.description}</td><td>{h.gst_rate}</td></tr>)}</tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field"><label>HSN code</label><input value={newHsn.hsn_code} onChange={e => setNewHsn({ ...newHsn, hsn_code: e.target.value })} /></div>
          <div className="field grow"><label>Description</label><input value={newHsn.description} onChange={e => setNewHsn({ ...newHsn, description: e.target.value })} /></div>
          <div className="field"><label>GST %</label><MoneyInput value={newHsn.gst_rate} onChange={n => setNewHsn({ ...newHsn, gst_rate: n })} /></div>
          <div className="field" style={{ justifyContent: 'flex-end' }}><button onClick={addHsn}>Add / update</button></div>
        </div>
      </div>
    </div>
  )
}
