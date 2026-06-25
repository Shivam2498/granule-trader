import type { Sale, SaleAllocation, Settings } from '@shared/types'
import { formatINR } from '../lib/format'
import './invoice.css'

function addr(json: string): string {
  if (!json) return ''
  try { const o = JSON.parse(json); return [o.address, o.city, o.state, o.pincode].filter(Boolean).join(', ') } catch { return '' }
}

export default function InvoiceTemplate({ sale, allocations, settings }: { sale: Sale; allocations: SaleAllocation[]; settings: Settings }) {
  const interState = sale.igst > 0
  // HSN-wise taxable + tax breakup
  const byHsn = new Map<string, { hsn: string; rate: number; taxable: number }>()
  for (const a of allocations) {
    const key = `${a.hsn_code}@${a.gst_rate}`
    const cur = byHsn.get(key) ?? { hsn: a.hsn_code, rate: a.gst_rate, taxable: 0 }
    cur.taxable = Math.round((cur.taxable + a.line_amount + Number.EPSILON) * 100) / 100
    byHsn.set(key, cur)
  }
  const groups = [...byHsn.values()]
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

  return (
    <div className="invoice">
      <div className="head">
        <div><h2>{settings.seller_name}</h2><div>{[settings.seller_address, settings.seller_city, settings.home_state].filter(Boolean).join(', ')}</div>
          <div>GSTIN: {settings.seller_gstin} · PAN: {settings.seller_pan}{settings.seller_phone ? ` · ${settings.seller_phone}` : ''}</div></div>
        <div style={{ textAlign: 'right' }}><b>TAX INVOICE</b><div>{sale.invoice_number}</div><div>{sale.invoice_date}</div></div>
      </div>
      <table>
        <tbody>
          <tr><td><b>Buyer:</b> {sale.buyer_name}<br />{addr(sale.buyer_billing_json)}<br />GSTIN: {sale.buyer_gstin}</td>
            <td><b>Ship to:</b><br />{addr(sale.buyer_shipping_json) || addr(sale.buyer_billing_json)}</td></tr>
        </tbody>
      </table>
      {(() => { const parts = [sale.eway_bill_no ? `E-way bill: ${sale.eway_bill_no} (${sale.eway_bill_date ?? ''})` : '', sale.vehicle ? `Vehicle: ${sale.vehicle}` : ''].filter(Boolean); return parts.length ? <p>{parts.join(' · ')}</p> : null })()}
      <table>
        <thead><tr><th>#</th><th>HSN</th><th>Qty (kg)</th><th>Rate/kg</th><th>Amount</th></tr></thead>
        <tbody>{allocations.map((a, i) => (
          <tr key={a.id}><td>{i + 1}</td><td>{a.hsn_code}</td><td>{a.qty_drawn_kg}</td><td>{formatINR(a.rate_per_kg)}</td><td>{formatINR(a.line_amount)}</td></tr>
        ))}</tbody>
      </table>

      <table style={{ marginTop: 8 }}>
        <thead><tr><th>HSN</th><th>Taxable</th>{interState ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}</tr></thead>
        <tbody>{groups.map(g => (
          <tr key={g.hsn + g.rate}><td>{g.hsn} ({g.rate}%)</td><td>{formatINR(g.taxable)}</td>
            {interState
              ? <td>{formatINR(r2(g.taxable * g.rate / 100))}</td>
              : <><td>{formatINR(r2(g.taxable * g.rate / 2 / 100))}</td><td>{formatINR(r2(g.taxable * g.rate / 2 / 100))}</td></>}
          </tr>))}</tbody>
      </table>

      <table className="totals" style={{ marginTop: 8 }}>
        <tbody>
          <tr><td style={{ textAlign: 'right' }}>Taxable value</td><td style={{ textAlign: 'right' }}>{formatINR(sale.amount)}</td></tr>
          {interState
            ? <tr><td style={{ textAlign: 'right' }}>IGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.igst)}</td></tr>
            : <><tr><td style={{ textAlign: 'right' }}>CGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.cgst)}</td></tr>
              <tr><td style={{ textAlign: 'right' }}>SGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.sgst)}</td></tr></>}
          {sale.roundoff ? <tr><td style={{ textAlign: 'right' }}>Round off</td><td style={{ textAlign: 'right' }}>{formatINR(sale.roundoff)}</td></tr> : null}
          <tr><td style={{ textAlign: 'right' }}><b>Total</b></td><td style={{ textAlign: 'right' }}><b>{formatINR(sale.total_invoice_amount)}</b></td></tr>
        </tbody>
      </table>
    </div>
  )
}
