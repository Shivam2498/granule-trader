import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TextInput, Select, Input, Button, Paper, Text, Table, Group, ActionIcon } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import type { HsnProduct, Settings, Supplier } from '@shared/types'
import { computePurchaseTax } from '@shared/tax'
import { round2 } from '@shared/money'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import TaxSummary from '../components/TaxSummary'
import DateField from '../components/DateField'
import { formatINR, today, formatAddress } from '../lib/format'

interface ItemRow { id?: number; hsn_code: string; description: string; qty_kg: number; rate_per_kg: number }
const blankItem = (): ItemRow => ({ hsn_code: '', description: '', qty_kg: 0, rate_per_kg: 0 })

export default function PurchaseForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [error, setError] = useState('')
  const [codeEdited, setCodeEdited] = useState(false)
  const [saving, setSaving] = useState(false)

  const form = useForm({
    mode: 'controlled',
    initialValues: {
      our_code: '', supplier_invoice_number: '', invoice_date: today(),
      supplier_id: null as number | null,
      eway_bill_no: '', eway_bill_date: '', vehicle: '',
      items: [blankItem()] as ItemRow[],
      roundoff: 0, tcs: 0,
      payment_status: 'pending' as 'pending' | 'done', payment_date: '' as string
    },
    validate: {
      our_code: isNotEmpty('Enter the code.'),
      invoice_date: isNotEmpty('Pick the invoice date.'),
      supplier_id: (v) => v ? null : 'Choose a supplier.',
      items: {
        hsn_code: (v: string) => v ? null : 'Choose the HSN.',
        qty_kg: (v: number) => v > 0 ? null : 'Enter a quantity.',
        rate_per_kg: (v: number) => v > 0 ? null : 'Enter a rate per kg.'
      }
    }
  })

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn()); setSuppliers(await window.api.listSuppliers())
      if (editId) {
        const p = (await window.api.listPurchases()).find(x => x.id === editId)
        if (!p) { setError('Record not found.'); nav('/purchases'); return }
        const items = await window.api.getPurchaseItems(editId)
        form.setValues({
          our_code: p.our_code, supplier_invoice_number: p.supplier_invoice_number, invoice_date: p.invoice_date,
          supplier_id: p.supplier_id,
          eway_bill_no: p.eway_bill_no ?? '', eway_bill_date: p.eway_bill_date ?? '', vehicle: p.vehicle ?? '',
          items: items.length
            ? items.map(i => ({
                id: i.id, hsn_code: i.hsn_code, description: i.description, qty_kg: i.qty_kg,
                rate_per_kg: i.rate_per_kg > 0 ? i.rate_per_kg : (i.qty_kg > 0 ? round2(i.amount / i.qty_kg) : 0)
              }))
            : [blankItem()],
          roundoff: p.roundoff, tcs: p.tcs, payment_status: p.payment_status, payment_date: p.payment_date ?? ''
        })
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })() }, [editId])

  // auto-suggest code only when creating (never overwrite an edited purchase's code or a manually edited code)
  useEffect(() => { if (!editId && !codeEdited) window.api.nextPurchaseCode(form.values.invoice_date).then(c => form.setFieldValue('our_code', c)) }, [form.values.invoice_date, editId, codeEdited])

  if (!settings) return <FormPage title="Purchase" onBack={() => nav('/purchases')} footer={null}><p>Loading…</p></FormPage>

  const supplier = suppliers.find(s => s.id === form.values.supplier_id) ?? null
  const rateOf = (code: string) => hsn.find(h => h.hsn_code === code)?.gst_rate ?? settings.default_gst_rate

  const taxLines = form.values.items.map(i => ({
    qty_kg: i.qty_kg, rate_per_kg: i.rate_per_kg, gst_rate: rateOf(i.hsn_code), hsn_code: i.hsn_code
  }))
  const tax = computePurchaseTax({
    lines: taxLines, placeOfSupplyState: supplier?.state ?? '', homeState: settings.home_state,
    tcs: form.values.tcs, roundoff: form.values.roundoff
  })
  const intra = tax.igst === 0
  const rows = [
    { label: intra ? 'CGST' : 'CGST 0%', value: tax.cgst },
    { label: intra ? 'SGST' : 'SGST 0%', value: tax.sgst },
    { label: intra ? 'IGST 0%' : 'IGST', value: tax.igst },
    { label: 'TCS', value: tax.tcs }
  ]

  async function handleSave(v: typeof form.values) {
    if (saving) return
    setError('')
    // A blank supplier state silently reads as inter-state and would book the whole GST as IGST.
    // Refuse rather than guess — the tax split is decided by the supplier's state, not a default.
    if (!supplier?.state?.trim()) {
      setError(`${supplier?.name ?? 'This supplier'} has no state set, so GST cannot be worked out. Open the Suppliers screen and set their state.`)
      return
    }
    setSaving(true)
    try {
      const payload = {
        our_code: v.our_code, supplier_invoice_number: v.supplier_invoice_number, invoice_date: v.invoice_date,
        supplier_id: v.supplier_id,
        eway_bill_no: v.eway_bill_no, eway_bill_date: v.eway_bill_date, vehicle: v.vehicle,
        party: supplier?.name ?? '', party_state: supplier?.state ?? '',
        party_city: supplier?.city ?? '', party_pincode: supplier?.pincode ?? '', party_address: supplier?.address ?? '',
        homeState: settings!.home_state, roundoff: v.roundoff, tcs: v.tcs,
        items: v.items.map(i => ({
          id: i.id, hsn_code: i.hsn_code, description: i.description,
          qty_kg: i.qty_kg, rate_per_kg: i.rate_per_kg, gst_rate: rateOf(i.hsn_code)
        })),
        payment_status: v.payment_status, payment_date: v.payment_status === 'done' ? (v.payment_date || today()) : null
      }
      if (editId) await window.api.updatePurchase(editId, payload); else await window.api.createPurchase(payload)
      nav('/purchases')
    } catch (e: any) { setError(e.message ?? String(e)); setSaving(false) }
  }

  const hsnOptions = hsn.map(h => ({ value: h.hsn_code, label: `${h.hsn_code} (${h.gst_rate}%)` }))

  return (
    <FormPage title={editId ? 'Edit purchase' : 'Add purchase'} onBack={() => nav('/purchases')} error={error}
      footer={<><Button variant="default" onClick={() => nav('/purchases')}>Cancel</Button><Button loading={saving} onClick={() => form.onSubmit(handleSave)()}>{editId ? 'Update purchase' : 'Save purchase'}</Button></>}>
      <FormSection title="Invoice">
        <TextInput label="Our code" withAsterisk {...form.getInputProps('our_code')}
          onChange={e => { setCodeEdited(true); form.setFieldValue('our_code', e.currentTarget.value) }} />
        <TextInput label="Supplier invoice no." {...form.getInputProps('supplier_invoice_number')} />
        <Input.Wrapper label="Invoice date" error={form.errors.invoice_date}>
          <DateField value={form.values.invoice_date} onChange={d => form.setFieldValue('invoice_date', d)} />
        </Input.Wrapper>
        <TextInput label="E-way bill no." placeholder="from the supplier's bill" {...form.getInputProps('eway_bill_no')} />
        <Input.Wrapper label="E-way bill date">
          <DateField value={form.values.eway_bill_date} onChange={d => form.setFieldValue('eway_bill_date', d)} />
        </Input.Wrapper>
        <TextInput label="Vehicle no." {...form.getInputProps('vehicle')} />
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

      {/* One row per material on the supplier's invoice. Each row becomes its own stock lot, so a
          two-material invoice gives you two lots you can sell from independently. */}
      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="xs">Items</Text>
        <Text c="dimmed" size="sm" mb="md">
          Add one row per material on the supplier's invoice. Each row becomes a separate stock lot.
        </Text>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th style={{ width: 200 }}>HSN</Table.Th>
              <Table.Th>Description</Table.Th>
              <Table.Th style={{ width: 130 }}>Qty (kg)</Table.Th>
              <Table.Th style={{ width: 130 }}>Rate / kg</Table.Th>
              <Table.Th style={{ width: 130, textAlign: 'right' }}>Amount</Table.Th>
              <Table.Th style={{ width: 44 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {form.values.items.map((it, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <Select data={hsnOptions} placeholder="HSN"
                    value={it.hsn_code || null}
                    onChange={v => form.setFieldValue(`items.${i}.hsn_code`, v ?? '')}
                    error={form.errors[`items.${i}.hsn_code`]} />
                </Table.Td>
                <Table.Td>
                  <TextInput placeholder="e.g. Black M/B" {...form.getInputProps(`items.${i}.description`)} />
                </Table.Td>
                <Table.Td>
                  <Input.Wrapper error={form.errors[`items.${i}.qty_kg`]}>
                    <MoneyInput value={it.qty_kg} onChange={n => form.setFieldValue(`items.${i}.qty_kg`, n)} />
                  </Input.Wrapper>
                </Table.Td>
                <Table.Td>
                  <Input.Wrapper error={form.errors[`items.${i}.rate_per_kg`]}>
                    <MoneyInput value={it.rate_per_kg} onChange={n => form.setFieldValue(`items.${i}.rate_per_kg`, n)} decimals={4} />
                  </Input.Wrapper>
                </Table.Td>
                <Table.Td ta="right">{formatINR(round2(it.qty_kg * it.rate_per_kg))}</Table.Td>
                <Table.Td>
                  <ActionIcon variant="subtle" color="red" aria-label="Remove item"
                    disabled={form.values.items.length === 1}
                    onClick={() => form.removeListItem('items', i)}>✕</ActionIcon>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
        <Group mt="md" justify="space-between">
          <Button variant="default" onClick={() => form.insertListItem('items', blankItem())}>Add item</Button>
          <Text fw={600}>Taxable total: {formatINR(tax.taxable_amount)}</Text>
        </Group>
      </Paper>

      <FormSection title="Amounts">
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
