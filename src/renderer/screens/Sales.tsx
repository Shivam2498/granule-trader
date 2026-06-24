import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Sale } from '@shared/types'
import PageHeader from '../components/PageHeader'
import { formatINR } from '../lib/format'

export default function Sales() {
  const nav = useNavigate()
  const [list, setList] = useState<Sale[]>([])
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listSales()) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [])
  async function remove(id: number) {
    setError('')
    if (!confirm('Delete this sale? Stock will be restored.')) return
    try { await window.api.deleteSale(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Sales" action={<button className="primary" onClick={() => nav('/sales/new')}>+ New sale</button>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th className="num">Qty</th><th className="num">Total</th><th>Payment</th><th></th></tr></thead>
          <tbody>{list.map(s => s.status === 'reserved' ? (
            <tr key={s.id} className="muted">
              <td>{s.invoice_number}</td><td colSpan={4}><i>reserved — blank</i></td><td></td>
              <td className="num"><button className="link" onClick={() => nav(`/sales/fill/${s.id}`)}>Fill</button></td>
            </tr>
          ) : (
            <tr key={s.id}>
              <td>{s.invoice_number}</td><td>{s.invoice_date}</td><td>{s.buyer_name}</td>
              <td className="num">{s.total_qty_kg}</td><td className="num">{formatINR(s.total_invoice_amount)}</td>
              <td><span className={'pill ' + s.payment_status}>{s.payment_status}</span></td>
              <td className="num">
                <button className="link" onClick={() => nav(`/invoice/${s.id}`)}>Preview / PDF</button>{' '}
                <button className="link danger" onClick={() => remove(s.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7} className="muted">No sales yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
