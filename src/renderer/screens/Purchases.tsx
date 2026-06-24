import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Purchase } from '@shared/types'
import PageHeader from '../components/PageHeader'
import { formatINR } from '../lib/format'

export default function Purchases() {
  const nav = useNavigate()
  const [list, setList] = useState<Purchase[]>([])
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listPurchases()) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [])
  async function remove(id: number) {
    setError('')
    if (!confirm('Delete this purchase? Stock will be recalculated.')) return
    try { await window.api.deletePurchase(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Purchases" action={<button className="primary" onClick={() => nav('/purchases/new')}>+ Add purchase</button>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Date</th><th>Supplier</th><th>HSN</th><th className="num">Qty</th><th className="num">Remaining</th><th className="num">Total</th><th>Payment</th><th></th></tr></thead>
          <tbody>{list.map(p => (
            <tr key={p.id}>
              <td>{p.our_code}</td><td>{p.invoice_date}</td><td>{p.party}</td><td>{p.hsn_code}</td>
              <td className="num">{p.qty_kg}</td><td className="num">{p.qty_remaining_kg}</td><td className="num">{formatINR(p.total_invoice_amount)}</td>
              <td><span className={'pill ' + p.payment_status}>{p.payment_status}</span></td>
              <td className="num"><button className="link" onClick={() => nav(`/purchases/edit/${p.id}`)}>Edit</button>{' '}
                <button className="link danger" onClick={() => remove(p.id)}>Delete</button></td>
            </tr>))}
            {list.length === 0 && <tr><td colSpan={9} className="muted">No purchases yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
