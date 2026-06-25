import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  Alert, Button, Checkbox, Collapse, Group, Input, Paper,
  Select, Table, Text, TextInput
} from '@mantine/core'
import type { Customer, AvailableLot, Settings, HsnProduct } from '@shared/types'
import { computeSaleTax } from '@shared/tax'
import { placeOfSupplyState } from '../../main/core/customers'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import PageHeader from '../components/PageHeader'
import TaxSummary from '../components/TaxSummary'
import DateField from '../components/DateField'
import { formatINR, today } from '../lib/format'

interface Draw { include: boolean; qty: number; rate: number }

export default function NewSale() {
  const nav = useNavigate()
  const { id } = useParams()
  const fillId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [lots, setLots] = useState<AvailableLot[]>([])
  const [purchaseCost, setPurchaseCost] = useState<Map<number, number>>(new Map())
  const [error, setError] = useState('')

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [buyerId, setBuyerId] = useState<number | null>(null)
  const [showOptional, setShowOptional] = useState(false)
  const [ewayNo, setEwayNo] = useState(''); const [ewayDate, setEwayDate] = useState(''); const [vehicle, setVehicle] = useState('')
  const [roundoff, setRoundoff] = useState(0)
  const [payment, setPayment] = useState<'pending' | 'done'>('pending'); const [paymentDate, setPaymentDate] = useState('')
  const [draw, setDraw] = useState<Record<number, Draw>>({})

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setCustomers(await window.api.listCustomers()); setHsn(await window.api.listHsn())
      // cost/kg per lot = purchase.amount / qty_kg (reference only)
      const ps = await window.api.listPurchases()
      setPurchaseCost(new Map(ps.map(p => [p.id, p.qty_kg > 0 ? p.amount / p.qty_kg : 0])))
      if (fillId) { const { sale } = await window.api.getSaleWithAllocations(fillId); setInvoiceNumber(sale.invoice_number); setInvoiceDate(sale.invoice_date ?? today()) }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [fillId])

  useEffect(() => { window.api.listAvailableLots(invoiceDate, fillId ?? undefined).then(setLots).catch(e => setError(e.message ?? String(e))) }, [invoiceDate, fillId])
  useEffect(() => { if (!fillId && settings) window.api.nextInvoiceNumber(invoiceDate, settings.invoice_prefix).then(setInvoiceNumber) }, [invoiceDate, settings, fillId])

  const buyer = customers.find(c => c.id === buyerId) ?? null
  const placeOfSupply = buyer ? placeOfSupplyState(buyer) : ''
  const intra = !!settings && placeOfSupply.trim().toLowerCase() === settings.home_state.trim().toLowerCase()
  const hsnRate = useMemo(() => new Map(hsn.map(h => [h.hsn_code, h.gst_rate])), [hsn])

  const lines = useMemo(() => lots
    .filter(l => draw[l.purchase_id]?.include && (draw[l.purchase_id]?.qty ?? 0) > 0)
    .map(l => ({ purchase_id: l.purchase_id, qty_drawn_kg: draw[l.purchase_id].qty, rate_per_kg: draw[l.purchase_id].rate,
      hsn_code: l.hsn_code, gst_rate: hsnRate.get(l.hsn_code) ?? settings?.default_gst_rate ?? 18 })), [lots, draw, hsnRate, settings])

  const tax = computeSaleTax({ lines, placeOfSupplyState: placeOfSupply, homeState: settings?.home_state ?? '', roundoff })
  const rows = [
    { label: intra ? 'CGST' : 'CGST 0%', value: tax.cgst },
    { label: intra ? 'SGST' : 'SGST 0%', value: tax.sgst },
    { label: intra ? 'IGST 0%' : 'IGST', value: tax.igst }
  ]
  function setLine(pid: number, patch: Partial<Draw>) {
    setDraw(d => {
      const prev: Draw = d[pid] ?? { include: false, qty: 0, rate: 0 }
      return { ...d, [pid]: { ...prev, ...patch } }
    })
  }

  async function save(thenInvoice: boolean) {
    setError('')
    if (!buyer) { setError('Choose a buyer first.'); return }
    if (lines.length === 0) { setError('Tick at least one lot and enter quantity + rate.'); return }
    if (lines.some(l => l.rate_per_kg <= 0)) { setError('Enter a rate greater than 0 for every chosen lot.'); return }
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
      const sale = fillId ? await window.api.fillReservedSale(fillId, payload) : await window.api.createSale(payload)
      nav(thenInvoice ? `/invoice/${sale.id}` : '/sales')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  if (!settings) return <div className="content">Loading…</div>
  return (
    <div>
      <PageHeader title={fillId ? 'Fill reserved invoice' : 'New sale'} back={() => nav('/sales')} />
      {error && <Alert color="red" mb="md">{error}</Alert>}

      <Paper withBorder p="lg" radius="md" mb="md">
        <Group grow align="flex-start" mb="sm">
          <TextInput label="Invoice number" value={invoiceNumber} onChange={e => setInvoiceNumber(e.currentTarget.value)} />
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
        </Group>
        {buyer && (
          <Text size="sm" c="dimmed" mb="xs">
            Place of supply: <Text component="span" fw={700}>{placeOfSupply || '—'}</Text> → {intra ? 'CGST + SGST' : 'IGST'}
          </Text>
        )}
        <Button variant="subtle" size="xs" onClick={() => setShowOptional(s => !s)} mb="xs">
          {showOptional ? '▾' : '▸'} Optional (e-way bill, vehicle)
        </Button>
        <Collapse in={showOptional}>
          <Group grow align="flex-start" mt="xs">
            <TextInput label="E-way bill no." value={ewayNo} onChange={e => setEwayNo(e.currentTarget.value)} />
            <Input.Wrapper label="E-way bill date">
              <DateField value={ewayDate} onChange={setEwayDate} />
            </Input.Wrapper>
            <TextInput label="Vehicle" value={vehicle} onChange={e => setVehicle(e.currentTarget.value)} placeholder="By Taxi / By Van / GJ-05-…" />
          </Group>
        </Collapse>
      </Paper>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="sm">Choose stock to sell (lots available on {invoiceDate})</Text>
        <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
          <Table.Thead>
            <Table.Tr>
              <Table.Th></Table.Th>
              <Table.Th>Lot</Table.Th>
              <Table.Th>HSN</Table.Th>
              <Table.Th>Supplier</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Avail</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Cost/kg</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Sell/kg</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Qty</Table.Th>
              <Table.Th style={{ textAlign: 'right' }}>Amount</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {lots.map(l => {
              const d = draw[l.purchase_id] ?? { include: false, qty: 0, rate: 0 }
              const amt = d.include ? d.qty * d.rate : 0
              return (
                <Table.Tr key={l.purchase_id}>
                  <Table.Td>
                    <Checkbox
                      checked={d.include}
                      onChange={e => setLine(l.purchase_id, { include: e.currentTarget.checked })}
                    />
                  </Table.Td>
                  <Table.Td>{l.our_code}</Table.Td>
                  <Table.Td>{l.hsn_code}</Table.Td>
                  <Table.Td>{l.party}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{l.available_kg}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{formatINR(purchaseCost.get(l.purchase_id) ?? 0)}</Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {d.include ? <MoneyInput value={d.rate} onChange={n => setLine(l.purchase_id, { rate: n })} /> : '—'}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>
                    {d.include ? <MoneyInput value={d.qty} onChange={n => setLine(l.purchase_id, { qty: n })} /> : '—'}
                  </Table.Td>
                  <Table.Td style={{ textAlign: 'right' }}>{formatINR(amt)}</Table.Td>
                </Table.Tr>
              )
            })}
            {lots.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={9}>
                  <Text c="red">No stock available on this date.</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

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
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => nav('/sales')}>Cancel</Button>
          <Button onClick={() => save(false)}>Save</Button>
          <Button onClick={() => save(true)}>Save &amp; preview PDF</Button>
        </Group>
      </Paper>
    </div>
  )
}
