import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TextInput, Select, Input, Button, Textarea } from '@mantine/core'
import type { HsnProduct, Settings } from '@shared/types'
import { computeTax } from '@shared/tax'
import { isPincode } from '@shared/validation'
import { round2 } from '@shared/money'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import TaxSummary from '../components/TaxSummary'
import DateField from '../components/DateField'
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
          rate_per_kg: p.rate_per_kg > 0 ? p.rate_per_kg : (p.qty_kg > 0 ? round2(p.amount / p.qty_kg) : 0),
          roundoff: p.roundoff, tcs: p.tcs, payment_status: p.payment_status, payment_date: p.payment_date ?? ''
        })
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [editId])

  // auto-suggest code only when creating (never overwrite an edited purchase's code)
  useEffect(() => { if (!editId) window.api.nextPurchaseCode(form.invoice_date).then(c => setForm(f => ({ ...f, our_code: c }))) }, [form.invoice_date, editId])

  if (!settings) return <FormPage title="Purchase" onBack={() => nav('/purchases')} footer={null}><p>Loading…</p></FormPage>

  const amount = round2(form.qty_kg * form.rate_per_kg)
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

  return (
    <FormPage title={editId ? 'Edit purchase' : 'Add purchase'} onBack={() => nav('/purchases')} error={error}
      footer={<><Button variant="default" onClick={() => nav('/purchases')}>Cancel</Button><Button disabled={!valid} onClick={save}>{editId ? 'Update purchase' : 'Save purchase'}</Button></>}>
      <FormSection title="Invoice">
        <TextInput label="Our code" value={form.our_code} onChange={e => set({ our_code: e.currentTarget.value })} error={errs.our_code} />
        <TextInput label="Supplier invoice no." value={form.supplier_invoice_number} onChange={e => set({ supplier_invoice_number: e.currentTarget.value })} />
        <Input.Wrapper label="Invoice date" error={errs.invoice_date}>
          <DateField value={form.invoice_date} onChange={d => set({ invoice_date: d })} />
        </Input.Wrapper>
        <Select label="HSN" data={hsn.map(h => ({ value: h.hsn_code, label: `${h.hsn_code} (${h.gst_rate}%)` }))} value={form.hsn_code || null} onChange={v => set({ hsn_code: v ?? '' })} error={errs.hsn_code} />
      </FormSection>
      <FormSection title="Supplier">
        <TextInput label="Supplier name" value={form.party} onChange={e => set({ party: e.currentTarget.value })} error={errs.party} />
        <Input.Wrapper label="Pincode" error={errs.party_pincode}>
          <PincodeField value={form.party_pincode} onChange={v => set({ party_pincode: v })}
            onResolved={r => set({ party_city: r.city, party_state: r.state })} />
        </Input.Wrapper>
        <TextInput label="City" value={form.party_city} onChange={e => set({ party_city: e.currentTarget.value })} />
        <Input.Wrapper label="Supplier state" error={errs.party_state}>
          <StateSelect value={form.party_state} onChange={v => set({ party_state: v })} />
        </Input.Wrapper>
        <Textarea label="Street address" rows={2} value={form.party_address} onChange={e => set({ party_address: e.currentTarget.value })} />
      </FormSection>
      <FormSection title="Amounts">
        <Input.Wrapper label="Quantity (kg)" error={errs.qty_kg}>
          <MoneyInput value={form.qty_kg} onChange={n => set({ qty_kg: n })} />
        </Input.Wrapper>
        <Input.Wrapper label="Rate per kg" error={errs.rate_per_kg}>
          <MoneyInput value={form.rate_per_kg} onChange={n => set({ rate_per_kg: n })} />
        </Input.Wrapper>
        <TextInput label="Taxable amount" disabled value={formatINR(amount)} />
        <Input.Wrapper label="Round off (can be negative)">
          <SignedMoneyInput value={form.roundoff} onChange={n => set({ roundoff: n })} />
        </Input.Wrapper>
        <Input.Wrapper label="TCS">
          <MoneyInput value={form.tcs} onChange={n => set({ tcs: n })} />
        </Input.Wrapper>
        <Select label="Payment" data={[{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }]} value={form.payment_status} onChange={v => set({ payment_status: (v as 'pending' | 'done') })} />
        {form.payment_status === 'done' && (
          <Input.Wrapper label="Payment date">
            <DateField value={form.payment_date || today()} onChange={d => set({ payment_date: d })} />
          </Input.Wrapper>
        )}
      </FormSection>
      <div className="section"><h3>Tax</h3><div className="divider" /><TaxSummary taxable={tax.taxable_amount} rows={rows} total={tax.total} /></div>
    </FormPage>
  )
}
