import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TextInput, Select, Input, Button, Paper, Text } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import type { HsnProduct, Settings, Supplier } from '@shared/types'
import { computeTax } from '@shared/tax'
import { round2 } from '@shared/money'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import TaxSummary from '../components/TaxSummary'
import DateField from '../components/DateField'
import { formatINR, today, formatAddress } from '../lib/format'

export default function PurchaseForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [error, setError] = useState('')

  const form = useForm({
    mode: 'controlled',
    initialValues: {
      our_code: '', supplier_invoice_number: '', invoice_date: today(),
      supplier_id: null as number | null,
      hsn_code: '', qty_kg: 0, rate_per_kg: 0, roundoff: 0, tcs: 0,
      payment_status: 'pending' as 'pending' | 'done', payment_date: '' as string
    },
    validate: {
      our_code: isNotEmpty('Enter the code.'),
      invoice_date: isNotEmpty('Pick the invoice date.'),
      hsn_code: isNotEmpty('Choose the HSN.'),
      supplier_id: (v) => v ? null : 'Choose a supplier.',
      qty_kg: (v) => v > 0 ? null : 'Enter a quantity.',
      rate_per_kg: (v) => v > 0 ? null : 'Enter a rate per kg.'
    }
  })

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn()); setSuppliers(await window.api.listSuppliers())
      if (editId) {
        const p = (await window.api.listPurchases()).find(x => x.id === editId)
        if (p) form.setValues({
          our_code: p.our_code, supplier_invoice_number: p.supplier_invoice_number, invoice_date: p.invoice_date,
          supplier_id: p.supplier_id,
          hsn_code: p.hsn_code, qty_kg: p.qty_kg,
          rate_per_kg: p.rate_per_kg > 0 ? p.rate_per_kg : (p.qty_kg > 0 ? round2(p.amount / p.qty_kg) : 0),
          roundoff: p.roundoff, tcs: p.tcs, payment_status: p.payment_status, payment_date: p.payment_date ?? ''
        })
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })() }, [editId])

  // auto-suggest code only when creating (never overwrite an edited purchase's code)
  useEffect(() => { if (!editId) window.api.nextPurchaseCode(form.values.invoice_date).then(c => form.setFieldValue('our_code', c)) }, [form.values.invoice_date, editId])

  if (!settings) return <FormPage title="Purchase" onBack={() => nav('/purchases')} footer={null}><p>Loading…</p></FormPage>

  const supplier = suppliers.find(s => s.id === form.values.supplier_id) ?? null
  const amount = round2(form.values.qty_kg * form.values.rate_per_kg)
  const gstRate = hsn.find(h => h.hsn_code === form.values.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const tax = computeTax({ amount, gstRate, placeOfSupplyState: supplier?.state ?? '', homeState: settings.home_state, tcs: form.values.tcs, roundoff: form.values.roundoff })
  const intra = tax.igst === 0
  const rows = [
    { label: `CGST ${intra ? gstRate / 2 : 0}%`, value: tax.cgst },
    { label: `SGST ${intra ? gstRate / 2 : 0}%`, value: tax.sgst },
    { label: `IGST ${intra ? 0 : gstRate}%`, value: tax.igst },
    { label: 'TCS', value: tax.tcs }
  ]

  async function handleSave(v: typeof form.values) {
    setError('')
    try {
      const payload = {
        our_code: v.our_code, supplier_invoice_number: v.supplier_invoice_number, invoice_date: v.invoice_date,
        supplier_id: v.supplier_id,
        party: supplier?.name ?? '', party_state: supplier?.state ?? '',
        party_city: supplier?.city ?? '', party_pincode: supplier?.pincode ?? '', party_address: supplier?.address ?? '',
        hsn_code: v.hsn_code, qty_kg: v.qty_kg, rate_per_kg: v.rate_per_kg,
        gst_rate: gstRate, homeState: settings!.home_state, roundoff: v.roundoff, tcs: v.tcs,
        payment_status: v.payment_status, payment_date: v.payment_status === 'done' ? (v.payment_date || today()) : null
      }
      if (editId) await window.api.updatePurchase(editId, payload); else await window.api.createPurchase(payload)
      nav('/purchases')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <FormPage title={editId ? 'Edit purchase' : 'Add purchase'} onBack={() => nav('/purchases')} error={error}
      footer={<><Button variant="default" onClick={() => nav('/purchases')}>Cancel</Button><Button onClick={() => form.onSubmit(handleSave)()}>{editId ? 'Update purchase' : 'Save purchase'}</Button></>}>
      <FormSection title="Invoice">
        <TextInput label="Our code" {...form.getInputProps('our_code')} />
        <TextInput label="Supplier invoice no." {...form.getInputProps('supplier_invoice_number')} />
        <Input.Wrapper label="Invoice date" error={form.errors.invoice_date}>
          <DateField value={form.values.invoice_date} onChange={d => form.setFieldValue('invoice_date', d)} />
        </Input.Wrapper>
        <Select label="HSN" data={hsn.map(h => ({ value: h.hsn_code, label: `${h.hsn_code} (${h.gst_rate}%)` }))} value={form.values.hsn_code || null} onChange={v => form.setFieldValue('hsn_code', v ?? '')} error={form.errors.hsn_code} />
      </FormSection>
      <FormSection title="Supplier">
        <Select
          label="Supplier"
          withAsterisk
          searchable
          placeholder="Type a supplier name…"
          data={suppliers.map(s => ({ value: String(s.id), label: s.name + (s.gstin ? ` (${s.gstin})` : '') }))}
          value={form.values.supplier_id ? String(form.values.supplier_id) : null}
          onChange={v => form.setFieldValue('supplier_id', v ? Number(v) : null)}
          error={form.errors.supplier_id}
        />
        {supplier && (
          <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-gray-0)">
            <Text size="sm">GSTIN: <Text component="span" fw={600}>{supplier.gstin || '—'}</Text></Text>
            <Text size="sm">Phone: {supplier.phone || '—'}</Text>
            <Text size="sm">Address: {formatAddress(supplier)}</Text>
            <Text size="xs" c="dimmed" mt={4}>To edit these, open the Suppliers screen.</Text>
          </Paper>
        )}
      </FormSection>
      <FormSection title="Amounts">
        <Input.Wrapper label="Quantity (kg)" error={form.errors.qty_kg}>
          <MoneyInput value={form.values.qty_kg} onChange={n => form.setFieldValue('qty_kg', n)} />
        </Input.Wrapper>
        <Input.Wrapper label="Rate per kg" error={form.errors.rate_per_kg}>
          <MoneyInput value={form.values.rate_per_kg} onChange={n => form.setFieldValue('rate_per_kg', n)} />
        </Input.Wrapper>
        <TextInput label="Taxable amount" disabled value={formatINR(amount)} />
        <Input.Wrapper label="Round off (can be negative)">
          <SignedMoneyInput value={form.values.roundoff} onChange={n => form.setFieldValue('roundoff', n)} />
        </Input.Wrapper>
        <Input.Wrapper label="TCS">
          <MoneyInput value={form.values.tcs} onChange={n => form.setFieldValue('tcs', n)} />
        </Input.Wrapper>
        <Select label="Payment" data={[{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }]} value={form.values.payment_status} onChange={v => form.setFieldValue('payment_status', (v as 'pending' | 'done'))} />
        {form.values.payment_status === 'done' && (
          <Input.Wrapper label="Payment date">
            <DateField value={form.values.payment_date || today()} onChange={d => form.setFieldValue('payment_date', d)} />
          </Input.Wrapper>
        )}
      </FormSection>
      <FormSection title="Tax"><TaxSummary taxable={tax.taxable_amount} rows={rows} total={tax.total} /></FormSection>
    </FormPage>
  )
}
