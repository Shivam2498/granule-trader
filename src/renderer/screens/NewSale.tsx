import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import {
  Alert, Button, Center, Collapse, Group, Input, Loader, Paper,
  Select, Table, Text, TextInput, ActionIcon
} from '@mantine/core'
import type { Customer, AvailableLot, Settings, HsnProduct } from '@shared/types'
import { computeSaleTax, ewayBillRequired, EWAY_BILL_THRESHOLD } from '@shared/tax'
import { placeOfSupplyState } from '../../main/core/customers'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import PageHeader from '../components/PageHeader'
import TaxSummary from '../components/TaxSummary'
import DateField from '../components/DateField'
import { formatINR, today, formatAddress } from '../lib/format'
import { lotDrawError, saleFormError } from '../lib/sale-validation'
import { useSaleDraft, emptyDraft } from '../sale-draft'

export default function NewSale() {
  const nav = useNavigate()
  const { id } = useParams()
  const loc = useLocation()
  // One screen, three modes: create a new sale, fill a reserved gap, or edit an issued invoice.
  const mode: 'new' | 'fill' | 'edit' = loc.pathname.startsWith('/sales/edit') ? 'edit'
    : loc.pathname.startsWith('/sales/fill') ? 'fill' : 'new'
  const saleId = id ? Number(id) : null
  const key = saleId ? `${mode}:${saleId}` : 'new'
  const editId = mode === 'edit' ? saleId : null
  const fillId = mode === 'fill' ? saleId : null

  const { draft, patch, setLot, removeLot, reset } = useSaleDraft()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [lots, setLots] = useState<AvailableLot[]>([])
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [vehicleTouched, setVehicleTouched] = useState(false)
  const [showOptional, setShowOptional] = useState(false)

  // The draft outlives this screen — the user leaves it to pick lots and comes back. Only rebuild it
  // when it belongs to a DIFFERENT sale than the one now on screen.
  const fresh = draft.key !== key

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings())
      setCustomers(await window.api.listCustomers())
      setHsn(await window.api.listHsn())
      if (!fresh) return
      const base = emptyDraft(key)
      if (saleId) {
        const { sale, allocations } = await window.api.getSaleWithAllocations(saleId)
        base.invoiceNumber = sale.invoice_number
        base.invoiceEdited = true
        base.invoiceDate = sale.invoice_date ?? today()
        base.vehicle = sale.vehicle ?? ''
        if (editId) {
          base.buyerId = sale.buyer_customer_id
          base.ewayNo = sale.eway_bill_no ?? ''
          base.ewayDate = sale.eway_bill_date ?? ''
          base.roundoff = sale.roundoff
          base.payment = sale.payment_status
          base.paymentDate = sale.payment_date ?? ''
          base.lots = Object.fromEntries(allocations.map(a => [a.purchase_item_id, { qty: a.qty_drawn_kg, rate: a.rate_per_kg }]))
        }
      }
      reset(base)
    } catch (e: any) { setError(e.message ?? String(e)) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  })() }, [key])

  // Exclude this sale's own allocations from availability, or an edit would see its own stock as
  // already sold and refuse to keep the lots it is currently using.
  useEffect(() => {
    if (fresh) return
    window.api.listAvailableLots(draft.invoiceDate, saleId ?? undefined)
      .then(setLots).catch(e => setError(e.message ?? String(e)))
  }, [draft.invoiceDate, saleId, fresh])

  // Auto-suggest the next invoice number, but never clobber a number the user typed themselves.
  useEffect(() => {
    if (fresh || mode !== 'new' || !settings || draft.invoiceEdited) return
    window.api.nextInvoiceNumber(draft.invoiceDate, settings.invoice_prefix).then(n => patch({ invoiceNumber: n }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.invoiceDate, settings, mode, draft.invoiceEdited, fresh])

  const buyer = customers.find(c => c.id === draft.buyerId) ?? null
  const placeOfSupply = buyer ? placeOfSupplyState(buyer) : ''
  const intra = !!settings && placeOfSupply.trim().toLowerCase() === settings.home_state.trim().toLowerCase()
  const hsnRate = useMemo(() => new Map(hsn.map(h => [h.hsn_code, h.gst_rate])), [hsn])

  // Only the lots the user actually chose, in the order they were added.
  const chosen = useMemo(
    () => Object.keys(draft.lots).map(Number)
      .map(itemId => lots.find(l => l.purchase_item_id === itemId))
      .filter((l): l is AvailableLot => !!l),
    [draft.lots, lots]
  )

  const lines = useMemo(() => chosen
    .filter(l => (draft.lots[l.purchase_item_id]?.qty ?? 0) > 0)
    .map(l => ({
      purchase_item_id: l.purchase_item_id,
      qty_drawn_kg: draft.lots[l.purchase_item_id].qty,
      rate_per_kg: draft.lots[l.purchase_item_id].rate,
      hsn_code: l.hsn_code,
      gst_rate: hsnRate.get(l.hsn_code) ?? settings?.default_gst_rate ?? 18
    })), [chosen, draft.lots, hsnRate, settings])

  const tax = computeSaleTax({ lines, placeOfSupplyState: placeOfSupply, homeState: settings?.home_state ?? '', roundoff: draft.roundoff })
  const rows = [
    { label: intra ? 'CGST' : 'CGST 0%', value: tax.cgst },
    { label: intra ? 'SGST' : 'SGST 0%', value: tax.sgst },
    { label: intra ? 'IGST 0%' : 'IGST', value: tax.igst }
  ]
  const lotDraws = chosen.map(l => ({
    our_code: l.our_code,
    qty: draft.lots[l.purchase_item_id].qty,
    rate: draft.lots[l.purchase_item_id].rate,
    available: l.available_kg
  }))
  const ewayRequired = ewayBillRequired(tax.total)
  const formState = {
    invoiceNumber: draft.invoiceNumber, hasBuyer: !!buyer, vehicle: draft.vehicle,
    lots: lotDraws, total: tax.total, ewayNo: draft.ewayNo, ewayDate: draft.ewayDate
  }
  const formError = saleFormError(formState)

  async function save(thenInvoice: boolean) {
    if (saving) return
    setError('')
    const fe = saleFormError(formState)
    if (fe) { setError(fe); return }
    if (!buyer) return
    setSaving(true)
    const payload = {
      invoice_number: draft.invoiceNumber, invoice_date: draft.invoiceDate,
      buyer_customer_id: buyer.id, buyer_name: buyer.name, buyer_gstin: buyer.gstin,
      buyer_billing: { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode },
      buyer_shipping: buyer.shipping_same
        ? { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode }
        : { address: buyer.shipping_address, city: buyer.shipping_city, state: buyer.shipping_state, pincode: buyer.shipping_pincode },
      place_of_supply_state: placeOfSupply, homeState: settings!.home_state,
      lines, roundoff: draft.roundoff, eway_bill_no: draft.ewayNo, eway_bill_date: draft.ewayDate, vehicle: draft.vehicle,
      payment_status: draft.payment, payment_date: draft.payment === 'done' ? (draft.paymentDate || today()) : null
    }
    try {
      const sale = editId ? await window.api.updateSale(editId, payload)
        : fillId ? await window.api.fillReservedSale(fillId, payload)
        : await window.api.createSale(payload)
      reset(emptyDraft('none'))   // this draft is spent
      nav(thenInvoice ? `/invoice/${sale.id}` : '/sales')
    } catch (e: any) { setError(e.message ?? String(e)); setSaving(false) }
  }

  if (!settings || fresh) return <Center h="60vh"><Loader /></Center>
  return (
    <div>
      <PageHeader title={editId ? `Edit ${draft.invoiceNumber}` : fillId ? 'Fill reserved invoice' : 'New sale'} back={() => nav('/sales')} />
      {error && <Alert color="red" mb="md">{error}</Alert>}

      <Paper withBorder p="lg" radius="md" mb="md">
        <Group grow align="flex-start" mb="sm">
          <TextInput label="Invoice number" value={draft.invoiceNumber} disabled={mode === 'edit'}
            description={mode === 'edit' ? 'Cannot be changed once issued' : undefined}
            onChange={e => patch({ invoiceEdited: true, invoiceNumber: e.currentTarget.value })} />
          <Input.Wrapper label="Invoice date">
            <DateField value={draft.invoiceDate} onChange={d => patch({ invoiceDate: d })} />
          </Input.Wrapper>
          <Select
            label="Buyer"
            searchable
            data={customers.map(c => ({ value: String(c.id), label: c.name + (c.gstin ? ` (${c.gstin})` : '') }))}
            value={draft.buyerId ? String(draft.buyerId) : null}
            onChange={v => patch({ buyerId: v ? Number(v) : null })}
          />
          <TextInput
            label="Vehicle"
            withAsterisk
            value={draft.vehicle}
            onChange={e => patch({ vehicle: e.currentTarget.value })}
            onBlur={() => setVehicleTouched(true)}
            placeholder="By Taxi / By Van / GJ-05-…"
            error={vehicleTouched && !draft.vehicle.trim() ? 'Enter the vehicle number.' : undefined}
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
        <Button variant="subtle" size="xs" onClick={() => setShowOptional(s => !s)} mb="xs" disabled={ewayRequired}>
          {showOptional || ewayRequired ? '▾' : '▸'}{' '}
          {ewayRequired ? `E-way bill (required — this sale is over ${formatINR(EWAY_BILL_THRESHOLD)})` : 'Optional (e-way bill)'}
        </Button>
        <Collapse in={showOptional || ewayRequired}>
          <Group grow align="flex-start" mt="xs">
            <TextInput
              label="E-way bill no."
              withAsterisk={ewayRequired}
              value={draft.ewayNo}
              onChange={e => patch({ ewayNo: e.currentTarget.value })}
              error={ewayRequired && !draft.ewayNo.trim() ? 'Required over ₹50,000.' : undefined}
            />
            <Input.Wrapper
              label="E-way bill date"
              withAsterisk={ewayRequired}
              error={ewayRequired && !draft.ewayDate.trim() ? 'Required over ₹50,000.' : undefined}
            >
              <DateField value={draft.ewayDate} onChange={d => patch({ ewayDate: d })} />
            </Input.Wrapper>
          </Group>
        </Collapse>
      </Paper>

      {/* Choosing stock is its own page. This table shows only what you picked. */}
      <Paper withBorder p="lg" radius="md" mb="md">
        <Group justify="space-between" mb="sm">
          <Text fw={600}>Stock to sell</Text>
          <Button variant="default" onClick={() => nav('/sales/lots')}>+ Choose lots</Button>
        </Group>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Lot</Table.Th>
              <Table.Th>HSN</Table.Th>
              <Table.Th ta="right">Available</Table.Th>
              <Table.Th ta="right">Cost/kg</Table.Th>
              <Table.Th style={{ width: 150 }}>Sell/kg</Table.Th>
              <Table.Th style={{ width: 150 }}>Qty (kg)</Table.Th>
              <Table.Th ta="right">Amount</Table.Th>
              <Table.Th style={{ width: 44 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {chosen.map(l => {
              const d = draft.lots[l.purchase_item_id]
              const rowErr = lotDrawError({ our_code: l.our_code, qty: d.qty, rate: d.rate, available: l.available_kg })
              const margin = d.rate - l.rate_per_kg
              return (
                <Table.Tr key={l.purchase_item_id}>
                  <Table.Td>{l.our_code}</Table.Td>
                  <Table.Td>{l.hsn_code}</Table.Td>
                  <Table.Td ta="right">{l.available_kg}</Table.Td>
                  <Table.Td ta="right">{formatINR(l.rate_per_kg)}</Table.Td>
                  <Table.Td>
                    <MoneyInput value={d.rate} onChange={n => setLot(l.purchase_item_id, { rate: n })} />
                    {d.rate > 0 && (
                      <Text size="xs" mt={4} c={margin < 0 ? 'red' : 'dimmed'}>
                        {margin < 0 ? `${formatINR(Math.abs(margin))}/kg below cost` : `+${formatINR(margin)}/kg`}
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td>
                    <MoneyInput value={d.qty} onChange={n => setLot(l.purchase_item_id, { qty: n })} />
                    {rowErr && <Text c="red" size="xs" mt={4}>{rowErr}</Text>}
                  </Table.Td>
                  <Table.Td ta="right">{formatINR(d.qty * d.rate)}</Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" aria-label={`Remove ${l.our_code}`}
                      onClick={() => removeLot(l.purchase_item_id)}>✕</ActionIcon>
                  </Table.Td>
                </Table.Tr>
              )
            })}
            {chosen.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={8} c="dimmed">No lots chosen yet — press “Choose lots”.</Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      </Paper>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Group justify="space-between" align="flex-start">
          <div>
            <Input.Wrapper label="Round off (can be negative)" maw={220} mb="sm">
              <SignedMoneyInput value={draft.roundoff} onChange={n => patch({ roundoff: n })} />
            </Input.Wrapper>
            <Group align="flex-end" gap="sm">
              <Select
                label="Payment"
                data={[{ value: 'pending', label: 'Pending' }, { value: 'done', label: 'Done' }]}
                value={draft.payment}
                onChange={v => patch({ payment: v as 'pending' | 'done' })}
                maw={160}
              />
              {draft.payment === 'done' && (
                <Input.Wrapper label="Payment date">
                  <DateField value={draft.paymentDate || today()} onChange={d => patch({ paymentDate: d })} />
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
