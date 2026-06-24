import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Customer, AvailableLot, Settings, HsnProduct } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import { formatINR, today } from '../lib/format'
import { allocationSummary, type UiLine } from '../lib/allocation'
import { placeOfSupplyState } from '../../main/core/customers'   // pure helper, type-safe to import

export default function NewSale() {
  const nav = useNavigate()
  const { id } = useParams()                 // present on /sales/fill/:id
  const fillId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [lots, setLots] = useState<AvailableLot[]>([])
  const [error, setError] = useState('')

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [buyerId, setBuyerId] = useState<number | null>(null)
  const [hsnCode, setHsnCode] = useState('')
  const [evwBillNo, setEvwBillNo] = useState('')
  const [evwBillDate, setEvwBillDate] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [tcs, setTcs] = useState(0)
  const [roundoff, setRoundoff] = useState(0)
  const [draw, setDraw] = useState<Record<number, { qty: number; rate: number }>>({})

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings())
      setCustomers(await window.api.listCustomers())
      setHsn(await window.api.listHsn())
      if (fillId) {
        const { sale } = await window.api.getSaleWithAllocations(fillId)
        setInvoiceNumber(sale.invoice_number)
        setInvoiceDate(sale.invoice_date ?? today())
      }
    } catch (e: any) { setError('Could not load data: ' + (e.message ?? e)) }
  })() }, [fillId])

  // refresh available lots whenever the date changes (date-aware, excluding this sale when filling)
  useEffect(() => { window.api.listAvailableLots(invoiceDate, fillId ?? undefined).then(setLots) }, [invoiceDate, fillId])
  // suggest invoice number for a fresh sale
  useEffect(() => { if (!fillId && settings) window.api.nextInvoiceNumber(invoiceDate, settings.invoice_prefix).then(setInvoiceNumber) }, [invoiceDate, settings, fillId])

  const buyer = customers.find(c => c.id === buyerId) ?? null
  const placeOfSupply = buyer ? placeOfSupplyState(buyer) : ''
  const gstRate = hsn.find(h => h.hsn_code === hsnCode)?.gst_rate ?? settings?.default_gst_rate ?? 18
  const intra = !!settings && placeOfSupply.trim().toLowerCase() === settings.home_state.trim().toLowerCase()

  const lines: UiLine[] = useMemo(() => Object.entries(draw)
    .filter(([, d]) => d.qty > 0)
    .map(([pid, d]) => ({ purchase_id: Number(pid), qty_drawn_kg: d.qty, rate_per_kg: d.rate })), [draw])
  const summary = allocationSummary(lines)
  const taxTotal = r2(summary.amount * gstRate / 100)
  const cgst = intra ? r2(taxTotal / 2) : 0
  const igst = intra ? 0 : taxTotal
  const grandTotal = r2(summary.amount + cgst * 2 + igst + tcs + roundoff)

  function setLine(pid: number, patch: Partial<{ qty: number; rate: number }>) {
    setDraw(d => {
      const prev = d[pid] ?? { qty: 0, rate: 0 }
      return { ...d, [pid]: { qty: prev.qty, rate: prev.rate, ...patch } }
    })
  }

  async function save(thenInvoice: boolean) {
    setError('')
    if (!buyer) { setError('Choose a buyer first.'); return }
    if (lines.length === 0) { setError('Allocate quantity from at least one lot.'); return }
    if (lines.some(l => l.rate_per_kg <= 0)) { setError('Enter a rate greater than 0 for every allocated lot.'); return }
    const payload = {
      invoice_number: invoiceNumber, invoice_date: invoiceDate,
      buyer_customer_id: buyer.id, buyer_name: buyer.name, buyer_gstin: buyer.gstin,
      buyer_billing: { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode },
      buyer_shipping: buyer.shipping_same
        ? { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode }
        : { address: buyer.shipping_address, city: buyer.shipping_city, state: buyer.shipping_state, pincode: buyer.shipping_pincode },
      place_of_supply_state: placeOfSupply, homeState: settings!.home_state, hsn_code: hsnCode, gst_rate: gstRate,
      lines, tcs, roundoff, eway_bill_no: evwBillNo, eway_bill_date: evwBillDate, vehicle
    }
    try {
      const sale = fillId ? await window.api.fillReservedSale(fillId, payload) : await window.api.createSale(payload)
      if (thenInvoice) nav(`/sales?invoice=${sale.id}`)   // Task 22 reads ?invoice= to open the printable view
      else nav('/sales')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  if (!settings) return <h1>New sale</h1>
  return (
    <div>
      <h1>{fillId ? 'Fill reserved invoice' : 'New sale'}</h1>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <div className="row">
          <div className="field"><label>Invoice number</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
          <div className="field"><label>Invoice date</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
          <div className="field grow"><label>Buyer</label>
            <select value={buyerId ?? ''} onChange={e => setBuyerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— choose customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.gstin ? ` (${c.gstin})` : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>HSN</label>
            <select value={hsnCode} onChange={e => setHsnCode(e.target.value)}>
              <option value="">—</option>
              {hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
            </select>
          </div>
        </div>
        {buyer && <p>Place of supply: <b>{placeOfSupply}</b> → {intra ? 'CGST + SGST' : 'IGST'}</p>}
        <div className="row">
          <div className="field"><label>E-way bill no.</label><input value={evwBillNo} onChange={e => setEvwBillNo(e.target.value)} /></div>
          <div className="field"><label>E-way bill date</label><input type="date" value={evwBillDate} onChange={e => setEvwBillDate(e.target.value)} /></div>
          <div className="field grow"><label>Vehicle</label><input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="By Taxi / By Van / GJ-05-..." /></div>
        </div>
      </div>

      <div className="panel">
        <h2>Allocate from stock (lots available on {invoiceDate})</h2>
        <table>
          <thead><tr><th>Lot</th><th>Supplier</th><th>Available</th><th>Draw (kg)</th><th>Rate/kg</th><th>Amount</th></tr></thead>
          <tbody>{lots.map(l => {
            const d = draw[l.purchase_id] ?? { qty: 0, rate: 0 }
            return (
              <tr key={l.purchase_id}>
                <td>{l.our_code}</td><td>{l.party}</td><td>{l.available_kg}</td>
                <td><MoneyInput value={d.qty} onChange={n => setLine(l.purchase_id, { qty: n })} /></td>
                <td><MoneyInput value={d.rate} onChange={n => setLine(l.purchase_id, { rate: n })} /></td>
                <td>{formatINR(r2(d.qty * d.rate))}</td>
              </tr>)
          })}</tbody>
        </table>
        {lots.length === 0 && <p className="error">No stock available on this date.</p>}
      </div>

      <div className="panel">
        <div className="row">
          <div className="field"><label>TCS</label><MoneyInput value={tcs} onChange={setTcs} /></div>
          <div className="field"><label>Round off</label><MoneyInput value={roundoff} onChange={setRoundoff} /></div>
        </div>
        <p>Taxable {formatINR(summary.amount)} · {intra ? `CGST ${formatINR(cgst)} + SGST ${formatINR(cgst)}` : `IGST ${formatINR(igst)}`} · Qty {summary.totalQty} kg · <b>Total {formatINR(grandTotal)}</b></p>
        <button className="primary" onClick={() => save(false)}>Save sale &amp; draw stock</button>{' '}
        <button onClick={() => save(true)}>Save &amp; generate invoice PDF</button>{' '}
        <button onClick={() => nav('/sales')}>Cancel</button>
      </div>
    </div>
  )

  function r2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100 }
}
