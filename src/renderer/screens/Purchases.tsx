import { useEffect, useState } from 'react'
import type { Purchase, HsnProduct, Settings } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import { formatINR, today } from '../lib/format'

export default function Purchases() {
  const [list, setList] = useState<Purchase[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState({
    our_code: '', supplier_invoice_number: '', invoice_date: today(),
    party: '', party_state: '', hsn_code: '', qty_kg: 0, amount: 0,
    tcs: 0, roundoff: 0, payment_status: 'pending' as 'pending' | 'done'
  })
  const [error, setError] = useState('')

  async function reload() { setList(await window.api.listPurchases()) }
  useEffect(() => { (async () => {
    setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn()); reload()
  })() }, [])
  // suggest next code whenever the date changes — but not while editing an existing purchase
  useEffect(() => {
    if (!editId) {
      window.api.nextPurchaseCode(form.invoice_date).then(c => setForm(f => ({ ...f, our_code: c })))
    }
  }, [form.invoice_date, editId])

  if (!settings) return <h1>Purchases</h1>
  const gstRate = hsn.find(h => h.hsn_code === form.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const intra = form.party_state.trim().toLowerCase() === settings.home_state.trim().toLowerCase()
  const tax = round2(form.amount * gstRate / 100)
  const cgst = intra ? round2(tax / 2) : 0
  const igst = intra ? 0 : tax
  const total = round2(form.amount + cgst * 2 + igst + form.tcs + form.roundoff)

  function edit(p: Purchase) {
    setEditId(p.id)
    setForm({
      our_code: p.our_code,
      supplier_invoice_number: p.supplier_invoice_number,
      invoice_date: p.invoice_date,
      party: p.party,
      party_state: p.party_state,
      hsn_code: p.hsn_code,
      qty_kg: p.qty_kg,
      amount: p.amount,
      tcs: p.tcs,
      roundoff: p.roundoff,
      payment_status: p.payment_status
    })
  }

  async function reset() {
    setEditId(null)
    const d = today()
    const nextCode = await window.api.nextPurchaseCode(d)
    setForm({
      our_code: nextCode, supplier_invoice_number: '', invoice_date: d,
      party: '', party_state: '', hsn_code: '', qty_kg: 0, amount: 0,
      tcs: 0, roundoff: 0, payment_status: 'pending'
    })
  }

  async function save() {
    setError('')
    try {
      const payload = {
        our_code: form.our_code, supplier_invoice_number: form.supplier_invoice_number,
        invoice_date: form.invoice_date, party: form.party, party_state: form.party_state,
        hsn_code: form.hsn_code, qty_kg: form.qty_kg, amount: form.amount, gst_rate: gstRate,
        homeState: settings!.home_state, tcs: form.tcs, roundoff: form.roundoff, payment_status: form.payment_status
      }
      if (editId) {
        await window.api.updatePurchase(editId, payload)
      } else {
        await window.api.createPurchase(payload)
      }
      await reset()
      reload()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }
  async function remove(id: number) {
    setError('')
    try { if (confirm('Delete this purchase? Stock will be recalculated.')) { await window.api.deletePurchase(id); reload() } }
    catch (e: any) { setError(e.message ?? String(e)) }
  }
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }))

  return (
    <div>
      <h1>Purchases</h1>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <h2>{editId ? 'Edit purchase' : 'New purchase'}</h2>
        <div className="row">
          <div className="field"><label>Our code</label><input value={form.our_code} onChange={e => set({ our_code: e.target.value })} /></div>
          <div className="field grow"><label>Supplier invoice no.</label><input value={form.supplier_invoice_number} onChange={e => set({ supplier_invoice_number: e.target.value })} /></div>
          <div className="field"><label>Invoice date</label><input type="date" value={form.invoice_date} onChange={e => set({ invoice_date: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Supplier (party)</label><input value={form.party} onChange={e => set({ party: e.target.value })} /></div>
          <div className="field grow"><label>Supplier state</label><input value={form.party_state} onChange={e => set({ party_state: e.target.value })} placeholder="e.g. Gujarat" /></div>
          <div className="field"><label>HSN</label>
            <select value={form.hsn_code} onChange={e => set({ hsn_code: e.target.value })}>
              <option value="">—</option>
              {hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field"><label>Quantity (kg)</label><MoneyInput value={form.qty_kg} onChange={n => set({ qty_kg: n })} /></div>
          <div className="field"><label>Taxable amount</label><MoneyInput value={form.amount} onChange={n => set({ amount: n })} /></div>
          <div className="field"><label>TCS</label><MoneyInput value={form.tcs} onChange={n => set({ tcs: n })} /></div>
          <div className="field"><label>Round off</label><MoneyInput value={form.roundoff} onChange={n => set({ roundoff: n })} /></div>
          <div className="field"><label>Payment</label>
            <select value={form.payment_status} onChange={e => set({ payment_status: e.target.value as 'pending' | 'done' })}>
              <option value="pending">Pending</option><option value="done">Done</option>
            </select>
          </div>
        </div>
        <p>GST {gstRate}% → {intra ? `CGST ${formatINR(cgst)} + SGST ${formatINR(cgst)}` : `IGST ${formatINR(igst)}`} · <b>Total {formatINR(total)}</b></p>
        <button className="primary" onClick={save}>{editId ? 'Update purchase' : 'Save purchase (adds to stock)'}</button>{' '}
        {editId && <button onClick={reset}>Cancel</button>}
      </div>

      <div className="panel">
        <h2>All purchases</h2>
        <table>
          <thead><tr><th>Code</th><th>Date</th><th>Supplier</th><th>HSN</th><th>Qty</th><th>Remaining</th><th>Total</th><th>Pay</th><th></th></tr></thead>
          <tbody>{list.map(p => (
            <tr key={p.id}>
              <td>{p.our_code}</td><td>{p.invoice_date}</td><td>{p.party}</td><td>{p.hsn_code}</td>
              <td>{p.qty_kg}</td><td>{p.qty_remaining_kg}</td><td>{formatINR(p.total_invoice_amount)}</td>
              <td>{p.payment_status}</td>
              <td><button onClick={() => edit(p)}>Edit</button> <button className="danger" onClick={() => remove(p.id)}>Delete</button></td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  )

  function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100 }
}
