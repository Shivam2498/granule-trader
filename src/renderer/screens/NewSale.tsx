import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  Alert, Button, Center, Collapse, Group, Input, Loader, Paper,
  Select, Text, TextInput
} from '@mantine/core'
import type { Customer, AvailableLot, Settings, HsnProduct } from '@shared/types'
import { computeSaleTax, ewayBillRequired, EWAY_BILL_THRESHOLD } from '@shared/tax'
import { placeOfSupplyState } from '../../main/core/customers'
import SignedMoneyInput from '../components/SignedMoneyInput'
import SaleLines from '../components/SaleLines'
import PageHeader from '../components/PageHeader'
import TaxSummary from '../components/TaxSummary'
import DateField from '../components/DateField'
import { formatINR, today, formatAddress } from '../lib/format'
import { saleFormError } from '../lib/sale-validation'
import { type SaleLineDraft, toApiLines, reallocate, linesFromAllocations } from '../lib/sale-lines'

export default function NewSale() {
  const nav = useNavigate()
  const { id } = useParams()
  const loc = useLocation()
  // One screen, three modes: create a new sale, fill a reserved gap, or edit an issued invoice.
  const mode: 'new' | 'fill' | 'edit' = loc.pathname.startsWith('/sales/edit') ? 'edit'
    : loc.pathname.startsWith('/sales/fill') ? 'fill' : 'new'
  const saleId = id ? Number(id) : null
  const fillId = mode === 'fill' ? saleId : null
  const editId = mode === 'edit' ? saleId : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [lots, setLots] = useState<AvailableLot[]>([])
  const [error, setError] = useState('')

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceEdited, setInvoiceEdited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [buyerId, setBuyerId] = useState<number | null>(null)
  const [showOptional, setShowOptional] = useState(false)
  const [ewayNo, setEwayNo] = useState(''); const [ewayDate, setEwayDate] = useState(''); const [vehicle, setVehicle] = useState('')
  const [vehicleTouched, setVehicleTouched] = useState(false)
  const [roundoff, setRoundoff] = useState(0)
  const [payment, setPayment] = useState<'pending' | 'done'>('pending'); const [paymentDate, setPaymentDate] = useState('')
  const [saleLines, setSaleLines] = useState<SaleLineDraft[]>([])

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setCustomers(await window.api.listCustomers()); setHsn(await window.api.listHsn())
      if (saleId) {
        const { sale, allocations } = await window.api.getSaleWithAllocations(saleId)
        setInvoiceNumber(sale.invoice_number)
        setInvoiceDate(sale.invoice_date ?? today())
        setVehicle(sale.vehicle ?? '')
        if (editId) {
          setBuyerId(sale.buyer_customer_id)
          setEwayNo(sale.eway_bill_no ?? ''); setEwayDate(sale.eway_bill_date ?? '')
          setRoundoff(sale.roundoff); setPayment(sale.payment_status)
          setPaymentDate(sale.payment_date ?? '')
          setSaleLines(linesFromAllocations(allocations))
        }
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [saleId, editId])

  // Exclude this sale's own allocations from availability, or an edit would see its own stock as
  // already sold and refuse to keep the lots it is currently using.
  useEffect(() => { window.api.listAvailableLots(invoiceDate, saleId ?? undefined).then(setLots).catch(e => setError(e.message ?? String(e))) }, [invoiceDate, saleId])
  // Auto-suggest the next invoice number, but never clobber a number the user typed themselves.
  useEffect(() => { if (mode === 'new' && settings && !invoiceEdited) window.api.nextInvoiceNumber(invoiceDate, settings.invoice_prefix).then(setInvoiceNumber) }, [invoiceDate, settings, mode, invoiceEdited])

  const buyer = customers.find(c => c.id === buyerId) ?? null
  const placeOfSupply = buyer ? placeOfSupplyState(buyer) : ''
  const intra = !!settings && placeOfSupply.trim().toLowerCase() === settings.home_state.trim().toLowerCase()
  const hsnRate = useMemo(() => new Map(hsn.map(h => [h.hsn_code, h.gst_rate])), [hsn])

  const gstRateOf = (code: string) => hsnRate.get(code) ?? settings?.default_gst_rate ?? 18
  const lines = useMemo(() => toApiLines(saleLines, gstRateOf), [saleLines, hsnRate, settings])

  const tax = computeSaleTax({ lines, placeOfSupplyState: placeOfSupply, homeState: settings?.home_state ?? '', roundoff })
  const rows = [
    { label: intra ? 'CGST' : 'CGST 0%', value: tax.cgst },
    { label: intra ? 'SGST' : 'SGST 0%', value: tax.sgst },
    { label: intra ? 'IGST 0%' : 'IGST', value: tax.igst }
  ]
  const ewayRequired = ewayBillRequired(tax.total)
  const formState = { invoiceNumber, hasBuyer: !!buyer, vehicle, lines: saleLines, lots, total: tax.total, ewayNo, ewayDate }
  const formError = saleFormError(formState)

  async function save(thenInvoice: boolean) {
    if (saving) return
    setError('')
    const fe = saleFormError(formState)
    if (fe) { setError(fe); return }
    if (!buyer) return
    setSaving(true)
    const payload = {
      invoice_number: invoiceNumber, invoice_date: invoiceDate,
      buyer_customer_id: buyer.id, buyer_name: buyer.name, buyer_gstin: buyer.gstin,
      buyer_billing: { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode },
      buyer_shipping: buyer.shipping_same
        ? { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode }
        : { address: buyer.shipping_address, city: buyer.shipping_city, state: buyer.shipping_state, pincode: buyer.shipping_pincode },
      place_of_supply_state: placeOfSupply, homeState: settings!.home_state,
      lines, roundoff, eway_bill_no: ewayNo, eway_bill_date: ewayDate, vehicle,
      payment_status: payment, payment_date: payment === 'done' ? (paymentDate || today()) : null
    }
    try {
      const sale = editId ? await window.api.updateSale(editId, payload)
        : fillId ? await window.api.fillReservedSale(fillId, payload)
        : await window.api.createSale(payload)
      nav(thenInvoice ? `/invoice/${sale.id}` : '/sales')
    } catch (e: any) { setError(e.message ?? String(e)); setSaving(false) }
  }

  if (!settings) return <Center h="60vh"><Loader /></Center>
  return (
    <div>
      <PageHeader title={editId ? `Edit ${invoiceNumber}` : fillId ? 'Fill reserved invoice' : 'New sale'} back={() => nav('/sales')} />
      {error && <Alert color="red" mb="md">{error}</Alert>}

      <Paper withBorder p="lg" radius="md" mb="md">
        <Group grow align="flex-start" mb="sm">
          <TextInput label="Invoice number" value={invoiceNumber} disabled={mode === 'edit'}
            description={mode === 'edit' ? 'Cannot be changed once issued' : undefined}
            onChange={e => { setInvoiceEdited(true); setInvoiceNumber(e.currentTarget.value) }} />
          <Input.Wrapper label="Invoice date">
            <DateField value={invoiceDate} onChange={setInvoiceDate} />
          </Input.Wrapper>
          <Select
            label="Buyer"
            searchable
            data={customers.map(c => ({ value: String(c.id), label: c.name + (c.gstin ? ` (${c.gstin})` : '') }))}
            value={buyerId ? String(buyerId) : null}
            onChange={v => setBuyerId(v ? Number(v) : null)}
          />
          <TextInput
            label="Vehicle"
            withAsterisk
            value={vehicle}
            onChange={e => setVehicle(e.currentTarget.value)}
            onBlur={() => setVehicleTouched(true)}
            placeholder="By Taxi / By Van / GJ-05-…"
            error={vehicleTouched && !vehicle.trim() ? 'Enter the vehicle number.' : undefined}
          />
        </Group>
        {buyer && (
          <Paper withBorder p="sm" radius="sm" mb="xs" bg="var(--mantine-color-gray-0)">
            <Text size="sm">GSTIN: <Text component="span" fw={600}>{buyer.gstin || '—'}</Text></Text>
            <Text size="sm">Address: {formatAddress({ address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode })}</Text>
            <Text size="sm">
              Place of supply: <Text component="span" fw={700}>{placeOfSupply || '—'}</Text> → {intra ? 'CGST + SGST' : 'IGST'}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>To edit these, open the Customers screen.</Text>
          </Paper>
        )}
        {/* Over the GST threshold the e-way bill stops being optional, so the section opens itself
            and stays open — a required field hidden behind a collapsed toggle is a trap. */}
        <Button variant="subtle" size="xs" onClick={() => setShowOptional(s => !s)} mb="xs" disabled={ewayRequired}>
          {showOptional || ewayRequired ? '▾' : '▸'}{' '}
          {ewayRequired ? `E-way bill (required — this sale is over ${formatINR(EWAY_BILL_THRESHOLD)})` : 'Optional (e-way bill)'}
        </Button>
        <Collapse in={showOptional || ewayRequired}>
          <Group grow align="flex-start" mt="xs">
            <TextInput
              label="E-way bill no."
              withAsterisk={ewayRequired}
              value={ewayNo}
              onChange={e => setEwayNo(e.currentTarget.value)}
              error={ewayRequired && !ewayNo.trim() ? 'Required over ₹50,000.' : undefined}
            />
            <Input.Wrapper
              label="E-way bill date"
              withAsterisk={ewayRequired}
              error={ewayRequired && !ewayDate.trim() ? 'Required over ₹50,000.' : undefined}
            >
              <DateField value={ewayDate} onChange={setEwayDate} />
            </Input.Wrapper>
          </Group>
        </Collapse>
      </Paper>

      <SaleLines lots={lots} hsn={hsn} asOfDate={invoiceDate} lines={saleLines} onChange={setSaleLines} />

      <Paper withBorder p="lg" radius="md" mb="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Input.Wrapper label="Round off (can be negative)" maw={220} mb="sm">
              <SignedMoneyInput value={roundoff} onChange={setRoundoff} />
            </Input.Wrapper>
            <Group align="flex-end" gap="sm">
              <Select
                label="Payment"
                data={[{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }]}
                value={payment}
                onChange={v => setPayment(v as 'pending' | 'done')}
                maw={160}
              />
              {payment === 'done' && (
                <Input.Wrapper label="Payment date">
                  <DateField value={paymentDate || today()} onChange={setPaymentDate} />
                </Input.Wrapper>
              )}
            </Group>
          </div>
          <TaxSummary taxable={tax.taxable} rows={rows} total={tax.total} />
        </Group>
        <Group justify="flex-end" align="center" mt="md">
          {formError && <Text size="sm" c="dimmed" mr="auto">{formError}</Text>}
          <Button variant="default" onClick={() => nav('/sales')}>Cancel</Button>
          <Button disabled={!!formError || saving} loading={saving} onClick={() => save(false)}>Save</Button>
          <Button disabled={!!formError || saving} loading={saving} onClick={() => save(true)}>Save &amp; preview PDF</Button>
        </Group>
      </Paper>
    </div>
  )
}
