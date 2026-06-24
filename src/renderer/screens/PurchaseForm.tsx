import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { HsnProduct, Settings } from '@shared/types'
import { computeTax } from '@shared/tax'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import StateSelect from '../components/StateSelect'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import TaxSummary from '../components/TaxSummary'
import { today } from '../lib/format'

export default function PurchaseForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [form, setForm] = useState({
    our_code: '', supplier_invoice_number: '', invoice_date: today(),
    party: '', party_state: '', hsn_code: '', qty_kg: 0, amount: 0, roundoff: 0,
    payment_status: 'pending' as 'pending' | 'done', payment_date: '' as string
  })
  const [error, setError] = useState('')
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }))

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn())
      if (editId) {
        const p = (await window.api.listPurchases()).find(x => x.id === editId)
        if (p) setForm({ our_code: p.our_code, supplier_invoice_number: p.supplier_invoice_number, invoice_date: p.invoice_date,
          party: p.party, party_state: p.party_state, hsn_code: p.hsn_code, qty_kg: p.qty_kg, amount: p.amount,
          roundoff: p.roundoff, payment_status: p.payment_status, payment_date: p.payment_date ?? '' })
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [editId])

  // auto-suggest code only when creating (never overwrite an edited purchase's code)
  useEffect(() => { if (!editId) window.api.nextPurchaseCode(form.invoice_date).then(c => setForm(f => ({ ...f, our_code: c }))) }, [form.invoice_date, editId])

  if (!settings) return <FormPage title="Purchase" onBack={() => nav('/purchases')} footer={null}><p>Loading…</p></FormPage>

  const gstRate = hsn.find(h => h.hsn_code === form.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const tax = computeTax({ amount: form.amount, gstRate, placeOfSupplyState: form.party_state, homeState: settings.home_state, roundoff: form.roundoff })
  const intra = tax.igst === 0
  const rows = [
    { label: `CGST ${intra ? gstRate / 2 : 0}%`, value: tax.cgst },
    { label: `SGST ${intra ? gstRate / 2 : 0}%`, value: tax.sgst },
    { label: `IGST ${intra ? 0 : gstRate}%`, value: tax.igst }
  ]
  const valid = form.our_code.trim() && form.hsn_code && form.party_state && form.qty_kg > 0 && form.amount > 0

  async function save() {
    setError('')
    if (!valid) { setError('Fill code, supplier state, HSN, quantity and amount.'); return }
    try {
      const payload = {
        our_code: form.our_code, supplier_invoice_number: form.supplier_invoice_number, invoice_date: form.invoice_date,
        party: form.party, party_state: form.party_state, hsn_code: form.hsn_code, qty_kg: form.qty_kg, amount: form.amount,
        gst_rate: gstRate, homeState: settings!.home_state, roundoff: form.roundoff,
        payment_status: form.payment_status, payment_date: form.payment_status === 'done' ? (form.payment_date || today()) : null
      }
      if (editId) await window.api.updatePurchase(editId, payload); else await window.api.createPurchase(payload)
      nav('/purchases')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <FormPage title={editId ? 'Edit purchase' : 'Add purchase'} onBack={() => nav('/purchases')} error={error}
      footer={<><button onClick={() => nav('/purchases')}>Cancel</button><button className="primary" disabled={!valid} onClick={save}>{editId ? 'Update purchase' : 'Save purchase'}</button></>}>
      <FormSection title="Invoice">
        <div className="field"><label>Our code</label><input value={form.our_code} onChange={e => set({ our_code: e.target.value })} /></div>
        <div className="field"><label>Supplier invoice no.</label><input value={form.supplier_invoice_number} onChange={e => set({ supplier_invoice_number: e.target.value })} /></div>
        <div className="field"><label>Invoice date</label><input type="date" value={form.invoice_date} onChange={e => set({ invoice_date: e.target.value })} /></div>
        <div className="field"><label>HSN</label>
          <select value={form.hsn_code} onChange={e => set({ hsn_code: e.target.value })}>
            <option value="">— select —</option>{hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
          </select></div>
      </FormSection>
      <FormSection title="Supplier">
        <div className="field"><label>Supplier name</label><input value={form.party} onChange={e => set({ party: e.target.value })} /></div>
        <div className="field"><label>Supplier state</label><StateSelect value={form.party_state} onChange={v => set({ party_state: v })} /></div>
      </FormSection>
      <FormSection title="Amounts">
        <div className="field"><label>Quantity (kg)</label><MoneyInput value={form.qty_kg} onChange={n => set({ qty_kg: n })} /></div>
        <div className="field"><label>Taxable amount</label><MoneyInput value={form.amount} onChange={n => set({ amount: n })} /></div>
        <div className="field"><label>Round off (can be negative)</label><SignedMoneyInput value={form.roundoff} onChange={n => set({ roundoff: n })} /></div>
        <div className="field"><label>Payment</label>
          <select value={form.payment_status} onChange={e => set({ payment_status: e.target.value as 'pending' | 'done' })}>
            <option value="pending">Pending</option><option value="done">Done</option>
          </select></div>
        {form.payment_status === 'done' && (
          <div className="field"><label>Payment date</label><input type="date" value={form.payment_date || today()} onChange={e => set({ payment_date: e.target.value })} /></div>
        )}
      </FormSection>
      <div className="section"><h3>Tax</h3><div className="divider" /><TaxSummary taxable={tax.taxable_amount} rows={rows} total={tax.total} /></div>
    </FormPage>
  )
}
