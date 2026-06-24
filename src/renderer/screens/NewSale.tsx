import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Customer, AvailableLot, Settings, HsnProduct } from '@shared/types'
import { computeSaleTax } from '@shared/tax'
import { placeOfSupplyState } from '../../main/core/customers'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import PageHeader from '../components/PageHeader'
import TaxSummary from '../components/TaxSummary'
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
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <div className="form-grid">
          <div className="field"><label>Invoice number</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
          <div className="field"><label>Invoice date</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
          <div className="field full"><label>Buyer</label>
            <select value={buyerId ?? ''} onChange={e => setBuyerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— choose customer —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.gstin ? ` (${c.gstin})` : ''}</option>)}
            </select></div>
        </div>
        {buyer && <p className="muted">Place of supply: <b>{placeOfSupply || '—'}</b> → {intra ? 'CGST + SGST' : 'IGST'}</p>}
        <button className="link" onClick={() => setShowOptional(s => !s)}>{showOptional ? '▾' : '▸'} Optional (e-way bill, vehicle)</button>
        {showOptional && (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="field"><label>E-way bill no.</label><input value={ewayNo} onChange={e => setEwayNo(e.target.value)} /></div>
            <div className="field"><label>E-way bill date</label><input type="date" value={ewayDate} onChange={e => setEwayDate(e.target.value)} /></div>
            <div className="field full"><label>Vehicle</label><input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="By Taxi / By Van / GJ-05-…" /></div>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Choose stock to sell (lots available on {invoiceDate})</h3>
        <table>
          <thead><tr><th></th><th>Lot</th><th>HSN</th><th>Supplier</th><th className="num">Avail</th><th className="num">Cost/kg</th><th className="num">Sell/kg</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
          <tbody>{lots.map(l => {
            const d = draw[l.purchase_id] ?? { include: false, qty: 0, rate: 0 }
            const amt = d.include ? d.qty * d.rate : 0
            return (
              <tr key={l.purchase_id}>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={d.include} onChange={e => setLine(l.purchase_id, { include: e.target.checked })} /></td>
                <td>{l.our_code}</td><td>{l.hsn_code}</td><td>{l.party}</td><td className="num">{l.available_kg}</td>
                <td className="num">{formatINR(purchaseCost.get(l.purchase_id) ?? 0)}</td>
                <td className="num">{d.include ? <MoneyInput value={d.rate} onChange={n => setLine(l.purchase_id, { rate: n })} /> : '—'}</td>
                <td className="num">{d.include ? <MoneyInput value={d.qty} onChange={n => setLine(l.purchase_id, { qty: n })} /> : '—'}</td>
                <td className="num">{formatINR(amt)}</td>
              </tr>)
          })}
          {lots.length === 0 && <tr><td colSpan={9} className="error">No stock available on this date.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="field" style={{ maxWidth: 220 }}><label>Round off (can be negative)</label><SignedMoneyInput value={roundoff} onChange={setRoundoff} /></div>
            <div className="field" style={{ maxWidth: 320 }}><label>Payment</label>
              <div className="row" style={{ alignItems: 'center' }}>
                <select value={payment} onChange={e => setPayment(e.target.value as 'pending' | 'done')}>
                  <option value="pending">Pending</option><option value="done">Done</option></select>
                {payment === 'done' && <input type="date" value={paymentDate || today()} onChange={e => setPaymentDate(e.target.value)} />}
              </div></div>
          </div>
          <TaxSummary taxable={tax.taxable} rows={rows} total={tax.total} />
        </div>
        <div className="form-actions">
          <button onClick={() => nav('/sales')}>Cancel</button>
          <button className="primary" onClick={() => save(false)}>Save</button>
          <button className="primary" onClick={() => save(true)}>Save &amp; preview PDF</button>
        </div>
      </div>
    </div>
  )
}
