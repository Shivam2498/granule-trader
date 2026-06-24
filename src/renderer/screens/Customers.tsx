import { useEffect, useState } from 'react'
import type { Customer } from '@shared/types'

const EMPTY: Omit<Customer, 'id'> = {
  name: '', gstin: '', pan: '', phone: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

export default function Customers() {
  const [list, setList] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<Omit<Customer, 'id'>>(EMPTY)

  async function reload() { setList(await window.api.listCustomers(search || undefined)) }
  useEffect(() => { reload() }, [search])
  const set = (p: Partial<Omit<Customer, 'id'>>) => setForm({ ...form, ...p })

  function edit(c: Customer) { const { id, ...rest } = c; setEditId(id); setForm(rest) }
  function reset() { setEditId(null); setForm(EMPTY) }
  async function save() {
    if (!form.name.trim()) return
    if (editId) await window.api.updateCustomer(editId, form)
    else await window.api.createCustomer(form)
    reset(); reload()
  }
  async function remove(id: number) { if (confirm('Delete this customer?')) { await window.api.deleteCustomer(id); reload() } }

  return (
    <div>
      <h1>Customers</h1>
      <div className="panel">
        <input placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 360 }} />
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Name</th><th>GSTIN</th><th>City</th><th>State</th><th></th></tr></thead>
          <tbody>{list.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td><td>{c.gstin}</td><td>{c.billing_city}</td><td>{c.billing_state}</td>
              <td><button onClick={() => edit(c)}>Edit</button> <button className="danger" onClick={() => remove(c.id)}>Delete</button></td>
            </tr>))}</tbody>
        </table>
      </div>

      <div className="panel">
        <h2>{editId ? 'Edit customer' : 'New customer'}</h2>
        <div className="row">
          <div className="field grow"><label>Name</label><input value={form.name} onChange={e => set({ name: e.target.value })} /></div>
          <div className="field grow"><label>GSTIN</label><input value={form.gstin} onChange={e => set({ gstin: e.target.value })} /></div>
          <div className="field"><label>PAN</label><input value={form.pan} onChange={e => set({ pan: e.target.value })} /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={e => set({ phone: e.target.value })} /></div>
        </div>
        <h3>Billing</h3>
        <div className="field"><label>Address</label><textarea value={form.billing_address} onChange={e => set({ billing_address: e.target.value })} /></div>
        <div className="row">
          <div className="field grow"><label>City</label><input value={form.billing_city} onChange={e => set({ billing_city: e.target.value })} /></div>
          <div className="field grow"><label>State</label><input value={form.billing_state} onChange={e => set({ billing_state: e.target.value })} /></div>
          <div className="field"><label>Pincode</label><input value={form.billing_pincode} onChange={e => set({ billing_pincode: e.target.value })} /></div>
        </div>
        <label style={{ display: 'block', margin: '8px 0' }}>
          <input type="checkbox" checked={form.shipping_same} onChange={e => set({ shipping_same: e.target.checked })} /> Shipping same as billing
        </label>
        {!form.shipping_same && (
          <>
            <h3>Shipping</h3>
            <div className="field"><label>Address</label><textarea value={form.shipping_address} onChange={e => set({ shipping_address: e.target.value })} /></div>
            <div className="row">
              <div className="field grow"><label>City</label><input value={form.shipping_city} onChange={e => set({ shipping_city: e.target.value })} /></div>
              <div className="field grow"><label>State</label><input value={form.shipping_state} onChange={e => set({ shipping_state: e.target.value })} /></div>
              <div className="field"><label>Pincode</label><input value={form.shipping_pincode} onChange={e => set({ shipping_pincode: e.target.value })} /></div>
            </div>
          </>
        )}
        <button className="primary" onClick={save}>{editId ? 'Update' : 'Add'} customer</button>{' '}
        {editId && <button onClick={reset}>Cancel</button>}
      </div>
    </div>
  )
}
