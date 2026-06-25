import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { HsnProduct, Settings } from '@shared/types'
import { computeTax } from '@shared/tax'
import { isPincode } from '@shared/validation'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import TaxSummary from '../components/TaxSummary'
import { formatINR, today } from '../lib/format'

export default function PurchaseForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [form, setForm] = useState({
    our_code: '', supplier_invoice_number: '', invoice_date: today(),
    party: '', party_state: '', party_city: '', party_pincode: '', party_address: '',
    hsn_code: '', qty_kg: 0, rate_per_kg: 0, roundoff: 0, tcs: 0,
    payment_status: 'pending' as 'pending' | 'done', payment_date: '' as string
  })
  const [error, setError] = useState('')
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }))

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn())
      if (editId) {
        const p = (await window.api.listPurchases()).find(x => x.id === editId)
        if (p) setForm({
          our_code: p.our_code, supplier_invoice_number: p.supplier_invoice_number, invoice_date: p.invoice_date,
          party: p.party, party_state: p.party_state, party_city: p.party_city, party_pincode: p.party_pincode, party_address: p.party_address,
          hsn_code: p.hsn_code, qty_kg: p.qty_kg,
          rate_per_kg: p.rate_per_kg > 0 ? p.rate_per_kg : (p.qty_kg > 0 ? Math.round((p.amount / p.qty_kg) * 100) / 100 : 0),
          roundoff: p.roundoff, tcs: p.tcs, payment_status: p.payment_status, payment_date: p.payment_date ?? ''
        })
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [editId])

  // auto-suggest code only when creating (never overwrite an edited purchase's code)
  useEffect(() => { if (!editId) window.api.nextPurchaseCode(form.invoice_date).then(c => setForm(f => ({ ...f, our_code: c }))) }, [form.invoice_date, editId])

  if (!settings) return <FormPage title="Purchase" onBack={() => nav('/purchases')} footer={null}><p>Loading…</p></FormPage>

  const amount = Math.round((form.qty_kg * form.rate_per_kg + Number.EPSILON) * 100) / 100
  const gstRate = hsn.find(h => h.hsn_code === form.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const tax = computeTax({ amount, gstRate, placeOfSupplyState: form.party_state, homeState: settings.home_state, tcs: form.tcs, roundoff: form.roundoff })
  const intra = tax.igst === 0
  const rows = [
    { label: `CGST ${intra ? gstRate / 2 : 0}%`, value: tax.cgst },
    { label: `SGST ${intra ? gstRate / 2 : 0}%`, value: tax.sgst },
    { label: `IGST ${intra ? 0 : gstRate}%`, value: tax.igst },
    { label: 'TCS', value: tax.tcs }
  ]

  const errs = {
    our_code: form.our_code.trim() ? '' : 'Required',
    invoice_date: form.invoice_date ? '' : 'Required',
    party: form.party.trim() ? '' : 'Required',
    party_state: form.party_state.trim() ? '' : 'Required',
    hsn_code: form.hsn_code ? '' : 'Required',
    qty_kg: form.qty_kg > 0 ? '' : 'Enter a quantity',
    rate_per_kg: form.rate_per_kg > 0 ? '' : 'Enter a rate',
    party_pincode: !form.party_pincode || isPincode(form.party_pincode) ? '' : '6-digit pincode'
  }
  const valid = Object.values(errs).every(e => e === '')

  async function save() {
    setError('')
    if (!valid) { setError('Please fix the highlighted fields.'); return }
    try {
      const payload = {
        our_code: form.our_code, supplier_invoice_number: form.supplier_invoice_number, invoice_date: form.invoice_date,
        party: form.party, party_state: form.party_state, party_city: form.party_city, party_pincode: form.party_pincode, party_address: form.party_address,
        hsn_code: form.hsn_code, qty_kg: form.qty_kg, rate_per_kg: form.rate_per_kg,
        gst_rate: gstRate, homeState: settings!.home_state, roundoff: form.roundoff, tcs: form.tcs,
        payment_status: form.payment_status, payment_date: form.payment_status === 'done' ? (form.payment_date || today()) : null
      }
      if (editId) await window.api.updatePurchase(editId, payload); else await window.api.createPurchase(payload)
      nav('/purchases')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  const F = (label: string, node: React.ReactNode, err?: string) => (
    <div className="field"><label>{label}</label>{node}{err ? <div className="err">{err}</div> : null}</div>
  )

  return (
    <FormPage title={editId ? 'Edit purchase' : 'Add purchase'} onBack={() => nav('/purchases')} error={error}
      footer={<><button onClick={() => nav('/purchases')}>Cancel</button><button className="primary" disabled={!valid} onClick={save}>{editId ? 'Update purchase' : 'Save purchase'}</button></>}>
      <FormSection title="Invoice">
        {F('Our code', <input value={form.our_code} onChange={e => set({ our_code: e.target.value })} />, errs.our_code)}
        {F('Supplier invoice no.', <input value={form.supplier_invoice_number} onChange={e => set({ supplier_invoice_number: e.target.value })} />)}
        {F('Invoice date', <input type="date" value={form.invoice_date} onChange={e => set({ invoice_date: e.target.value })} />, errs.invoice_date)}
        {F('HSN', <select value={form.hsn_code} onChange={e => set({ hsn_code: e.target.value })}>
            <option value="">— select —</option>{hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
          </select>, errs.hsn_code)}
      </FormSection>
      <FormSection title="Supplier">
        {F('Supplier name', <input value={form.party} onChange={e => set({ party: e.target.value })} />, errs.party)}
        {F('Pincode', <PincodeField value={form.party_pincode} onChange={v => set({ party_pincode: v })}
            onResolved={r => set({ party_city: r.city, party_state: r.state })} />, errs.party_pincode)}
        {F('City', <input value={form.party_city} onChange={e => set({ party_city: e.target.value })} />)}
        {F('State', <StateSelect value={form.party_state} onChange={v => set({ party_state: v })} />, errs.party_state)}
        {F('Street address', <textarea rows={2} value={form.party_address} onChange={e => set({ party_address: e.target.value })} />)}
      </FormSection>
      <FormSection title="Amounts">
        {F('Quantity (kg)', <MoneyInput value={form.qty_kg} onChange={n => set({ qty_kg: n })} />, errs.qty_kg)}
        {F('Rate per kg', <MoneyInput value={form.rate_per_kg} onChange={n => set({ rate_per_kg: n })} />, errs.rate_per_kg)}
        {F('Taxable amount', <input readOnly value={formatINR(amount)} />)}
        {F('Round off (can be negative)', <SignedMoneyInput value={form.roundoff} onChange={n => set({ roundoff: n })} />)}
        {F('TCS', <MoneyInput value={form.tcs} onChange={n => set({ tcs: n })} />)}
        {F('Payment', <select value={form.payment_status} onChange={e => set({ payment_status: e.target.value as 'pending' | 'done' })}>
            <option value="pending">Pending</option><option value="done">Done</option></select>)}
        {form.payment_status === 'done' && F('Payment date', <input type="date" value={form.payment_date || today()} onChange={e => set({ payment_date: e.target.value })} />)}
      </FormSection>
      <div className="section"><h3>Tax</h3><div className="divider" /><TaxSummary taxable={tax.taxable_amount} rows={rows} total={tax.total} /></div>
    </FormPage>
  )
}
