import type { Sale, SaleAllocation, Settings } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { rupeesInWords } from '../lib/words'
import './invoice.css'

const PAYMENT_TERMS = 'Immediate'
const DELIVERY_TERMS = 'Ex-Godown - Freight arranged & paid by party'
const DECLARATION = 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.'

type Addr = { address?: string; city?: string; state?: string; pincode?: string }
function parseAddr(json: string): Addr { try { return (JSON.parse(json) || {}) as Addr } catch { return {} } }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const addrLine = (a: Addr) => [a.address, a.city, a.pincode].filter(Boolean).join(', ')

function partyLines(name: string, addr: Addr, gstin: string, pan: string) {
  return (
    <>
      <div className="bold">{name}</div>
      <div>{addrLine(addr)}</div>
      <div><b>GSTIN/UIN:</b> {gstin}</div>
      <div><b>PAN/IT No.:</b> {pan}</div>
      <div><b>State Name:</b> {addr.state ?? ''}</div>
      <div><b>Place of Supply:</b> {addr.state ?? ''}</div>
    </>
  )
}

export interface InvoiceTemplateProps {
  sale: Sale; allocations: SaleAllocation[]; settings: Settings; hsnDescriptions: Record<string, string>
}

export default function InvoiceTemplate({ sale, allocations, settings, hsnDescriptions }: InvoiceTemplateProps) {
  const interState = sale.igst > 0

  const lineMap = new Map<string, { hsn: string; rate: number; qty: number; amount: number }>()
  for (const a of allocations) {
    const k = `${a.hsn_code}@${a.rate_per_kg}`
    const g = lineMap.get(k) ?? { hsn: a.hsn_code, rate: a.rate_per_kg, qty: 0, amount: 0 }
    g.qty = r2(g.qty + a.qty_drawn_kg); g.amount = r2(g.amount + a.line_amount); lineMap.set(k, g)
  }
  const lines = [...lineMap.values()]

  const taxMap = new Map<string, { hsn: string; rate: number; taxable: number }>()
  for (const a of allocations) {
    const k = `${a.hsn_code}@${a.gst_rate}`
    const g = taxMap.get(k) ?? { hsn: a.hsn_code, rate: a.gst_rate, taxable: 0 }
    g.taxable = r2(g.taxable + a.line_amount); taxMap.set(k, g)
  }
  const taxGroups = [...taxMap.values()]
  const totalTax = r2(sale.cgst + sale.sgst + sale.igst)
  const billing = parseAddr(sale.buyer_billing_json)
  const shipping = parseAddr(sale.buyer_shipping_json)
  const hasShipping = !!(shipping.address || shipping.city || shipping.state || shipping.pincode)
  const ship = hasShipping ? shipping : billing
  const buyerPan = panFromGstin(sale.buyer_gstin)

  const copy = (marker: string) => (
    <div className="invoice" key={marker}>
      <div className="inv-marker">{marker}</div>
      <div className="inv-title">TAX INVOICE</div>

      <table className="inv"><tbody>
        <tr>
          <td className="seller">
            <div className="bold big">{settings.seller_name}</div>
            <div><b>Off:</b> {settings.seller_address}</div>
            {settings.seller_godown_address.trim() && settings.seller_godown_address.trim() !== settings.seller_address.trim()
              ? <div><b>Godown:</b> {settings.seller_godown_address}</div> : null}
            <div>{settings.home_state}</div>
            <div><b>GSTIN/UIN:</b> {settings.seller_gstin}</div>
            <div><b>PAN/IT No.:</b> {settings.seller_pan}</div>
            {settings.seller_udyam.trim() && settings.seller_udyam.trim() !== '-'
              ? <div><b>UDYAM No.:</b> {settings.seller_udyam}</div> : null}
            <div><b>Email:</b> {settings.seller_email}</div>
          </td>
          <td className="meta">
            <table className="kv"><tbody>
              <tr><td>Invoice No</td><td className="bold">{sale.invoice_number}</td><td>Date</td><td>{sale.invoice_date}</td></tr>
              <tr><td>e-Way Bill No</td><td>{sale.eway_bill_no ?? ''}</td><td>Date</td><td>{sale.eway_bill_date ?? ''}</td></tr>
              <tr><td>Delivery Note</td><td></td><td>Date</td><td></td></tr>
              <tr><td>Order No</td><td></td><td>Date</td><td></td></tr>
              <tr><td>Payment Terms</td><td colSpan={3}>{PAYMENT_TERMS}</td></tr>
              <tr><td>Vehicle No</td><td colSpan={3}>{sale.vehicle ?? ''}</td></tr>
              <tr><td>Delivery Terms</td><td colSpan={3}>{DELIVERY_TERMS}</td></tr>
              <tr><td>Remarks</td><td colSpan={3}></td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody></table>

      <table className="inv"><tbody>
        <tr><td className="bold half">Buyer (if other than consignee)</td><td className="bold half">Consignee</td></tr>
        <tr>
          <td className="party">{partyLines(sale.buyer_name, billing, sale.buyer_gstin, buyerPan)}</td>
          <td className="party">{partyLines(sale.buyer_name, ship, sale.buyer_gstin, buyerPan)}</td>
        </tr>
      </tbody></table>

      <table className="inv items">
        <thead><tr>
          <th>Sl No.</th><th>DESCRIPTION OF GOODS</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate/Unit</th><th>AMOUNT Rs.</th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={i === 0 ? 'firstline' : undefined}>
              <td>{i + 1}</td><td>{hsnDescriptions[l.hsn] ?? ''}</td><td>{l.hsn}</td>
              <td className="right">{l.qty}</td><td>Kgs</td><td className="right">₹ {num(l.rate)}</td><td className="right">{num(l.amount)}</td>
            </tr>
          ))}
          {interState
            ? <tr><td colSpan={6} className="right">IGST</td><td className="right">{num(sale.igst)}</td></tr>
            : <>
                <tr><td colSpan={6} className="right">CGST</td><td className="right">{num(sale.cgst)}</td></tr>
                <tr><td colSpan={6} className="right">SGST</td><td className="right">{num(sale.sgst)}</td></tr>
              </>}
          {sale.roundoff ? <tr><td colSpan={6} className="right">R/Off</td><td className="right">{num(sale.roundoff)}</td></tr> : null}
          <tr className="bold"><td colSpan={3} className="right">TOTAL</td><td className="right">{sale.total_qty_kg}</td><td>Kgs</td><td></td><td className="right">{num(sale.total_invoice_amount)}</td></tr>
        </tbody>
      </table>

      <table className="inv"><tbody>
        <tr><td className="bold">Amount Chargeable (in words)</td><td className="right">E.&amp; O.E</td></tr>
        <tr><td colSpan={2}>{rupeesInWords(sale.total_invoice_amount)}</td></tr>
      </tbody></table>

      <table className="inv tax">
        <thead>
          <tr>
            <th rowSpan={2}>HSN/SAC</th><th rowSpan={2}>Taxable Value</th>
            {interState ? <th colSpan={2}>Integrated Tax</th> : <><th colSpan={2}>Central Tax</th><th colSpan={2}>State Tax</th></>}
            <th rowSpan={2}>Total Tax Amount</th>
          </tr>
          <tr>{interState ? <><th>Rate</th><th>Amount</th></> : <><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th></>}</tr>
        </thead>
        <tbody>
          {taxGroups.map((g, i) => {
            const tax = r2(g.taxable * g.rate / 100), half = r2(g.taxable * g.rate / 200)
            return (
              <tr key={i}>
                <td>{g.hsn}</td><td className="right">{num(g.taxable)}</td>
                {interState
                  ? <><td className="right">{g.rate}%</td><td className="right">{num(tax)}</td></>
                  : <><td className="right">{g.rate / 2}%</td><td className="right">{num(half)}</td><td className="right">{g.rate / 2}%</td><td className="right">{num(half)}</td></>}
                <td className="right">{num(tax)}</td>
              </tr>
            )
          })}
          <tr className="bold">
            <td>Total</td><td className="right">{num(sale.amount)}</td>
            {interState
              ? <><td></td><td className="right">{num(sale.igst)}</td></>
              : <><td></td><td className="right">{num(sale.cgst)}</td><td></td><td className="right">{num(sale.sgst)}</td></>}
            <td className="right">{num(totalTax)}</td>
          </tr>
        </tbody>
      </table>

      <table className="inv"><tbody>
        <tr><td className="bold">Tax Amount (in words)</td><td>{rupeesInWords(totalTax)}</td></tr>
      </tbody></table>

      <table className="inv"><tbody>
        <tr>
          <td className="decl half"><div className="bold">DECLARATION:</div><div>{DECLARATION}</div></td>
          <td className="bank half">
            <div>Cheque/ RTGS in name of &quot;{settings.seller_name}&quot;</div>
            <div><b>Bank Name:</b> {settings.bank_name}</div>
            <div><b>Branch:</b> {settings.bank_branch}</div>
            <div><b>A/C No.:</b> {settings.bank_account_no}</div>
            <div><b>IFS Code:</b> {settings.bank_ifsc}</div>
          </td>
        </tr>
        <tr><td className="sign">Customer&apos;s Seal &amp; Signature</td><td className="sign right">for {settings.seller_name}</td></tr>
      </tbody></table>
    </div>
  )

  return <>{copy('Original')}{copy('Duplicate')}</>
}
