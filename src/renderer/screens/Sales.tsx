import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Sale } from '@shared/types'
import { formatINR } from '../lib/format'

export default function Sales() {
  const [list, setList] = useState<Sale[]>([])
  const [error, setError] = useState('')
  const nav = useNavigate()
  async function reload() {
    try { setList(await window.api.listSales()) }
    catch (e: any) { setError('Could not load sales: ' + (e.message ?? e)) }
  }
  useEffect(() => { reload() }, [])
  async function remove(id: number) {
    if (confirm('Delete this sale? Stock will be restored.')) {
      setError('')
      try { await window.api.deleteSale(id); reload() }
      catch (e: any) { setError('Could not delete sale: ' + (e.message ?? e)) }
    }
  }

  return (
    <div>
      <h1>Sales</h1>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <button className="primary" onClick={() => nav('/sales/new')}>+ New sale</button>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th>Qty</th><th>Total</th><th>Pay</th><th></th></tr></thead>
          <tbody>{list.map(s => s.status === 'reserved' ? (
            <tr key={s.id} style={{ color: 'var(--muted)' }}>
              <td>{s.invoice_number}</td><td colSpan={4}><i>reserved — blank</i></td><td></td>
              <td><button onClick={() => nav(`/sales/fill/${s.id}`)}>Fill</button></td>
            </tr>
          ) : (
            <tr key={s.id}>
              <td>{s.invoice_number}</td><td>{s.invoice_date}</td><td>{s.buyer_name}</td>
              <td>{s.total_qty_kg}</td><td>{formatINR(s.total_invoice_amount)}</td><td>{s.payment_status}</td>
              <td><button className="danger" onClick={() => remove(s.id)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
