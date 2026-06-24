import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer } from '@shared/types'
import PageHeader from '../components/PageHeader'

export default function Customers() {
  const nav = useNavigate()
  const [list, setList] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listCustomers(search || undefined)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [search])
  async function remove(id: number) {
    if (!confirm('Delete this customer?')) return
    try { await window.api.deleteCustomer(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Customers" action={<button className="primary" onClick={() => nav('/customers/new')}>+ Add customer</button>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <input placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 380, marginBottom: 16 }} />
        <table>
          <thead><tr><th>Name</th><th>GSTIN</th><th>City</th><th>State</th><th></th></tr></thead>
          <tbody>{list.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td><td>{c.gstin}</td><td>{c.billing_city}</td><td>{c.billing_state}</td>
              <td className="num"><button className="link" onClick={() => nav(`/customers/edit/${c.id}`)}>Edit</button>{' '}
                <button className="link danger" onClick={() => remove(c.id)}>Delete</button></td>
            </tr>))}
            {list.length === 0 && <tr><td colSpan={5} className="muted">No customers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
