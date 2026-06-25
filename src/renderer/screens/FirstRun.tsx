import { useState } from 'react'
import { isGstin, isPan, isMobile, isPincode, deriveInvoicePrefix } from '@shared/validation'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

export default function FirstRun({ onDone }: { onDone: () => void }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixEdited, setPrefixEdited] = useState(false)
  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')
  const [mobile, setMobile] = useState('')
  const [homeState, setHomeState] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [error, setError] = useState('')

  function setBusinessName(v: string) {
    setName(v)
    if (!prefixEdited) setPrefix(deriveInvoicePrefix(v))
  }
  async function pick() { const f = await window.api.chooseDataFolder(); if (f) setFolder(f) }

  const valid =
    !!folder && name.trim().length > 0 && isGstin(gstin) && isPan(pan) &&
    isMobile(mobile) && homeState.trim().length > 0 && prefix.trim().length > 0 &&
    (pincode === '' || isPincode(pincode))

  async function start() {
    setError('')
    if (!valid) { setError('Please fill every field correctly before continuing.'); return }
    try {
      await window.api.saveSettings({
        seller_name: name.trim(), seller_gstin: gstin.trim().toUpperCase(), seller_pan: pan.trim().toUpperCase(),
        seller_phone: mobile.trim(), seller_address: address.trim(),
        seller_city: city.trim(), seller_pincode: pincode.trim(), home_state: homeState,
        invoice_prefix: prefix.trim().toUpperCase()
      })
      onDone()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  const fieldErr = (cond: boolean, msg: string) => cond ? <div className="err">{msg}</div> : null

  return (
    <div className="content" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center' }}>Welcome to Granule Trader</h1>
      <p className="muted" style={{ textAlign: 'center', marginTop: 4 }}>A one-time setup of your business details.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="section">
          <h3>Data file</h3><div className="divider" />
          <div className="row" style={{ alignItems: 'center' }}>
            <input className="grow" readOnly value={folder ?? ''} placeholder="Choose a folder for your data file…" />
            <button onClick={pick}>Choose…</button>
          </div>
          <p className="muted" style={{ fontSize: 14 }}>A cloud-synced folder (Dropbox/Drive/iCloud) lets a second computer use the same data — open it on one computer at a time.</p>
        </div>

        <div className="section">
          <h3>Your business</h3><div className="divider" />
          <div className="form-grid">
            <div className="field full"><label>Business name</label>
              <input value={name} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Ramaxton Plastocrafts" /></div>
            <div className="field"><label>Invoice prefix (auto from name, editable)</label>
              <input value={prefix} onChange={e => { setPrefix(e.target.value.toUpperCase()); setPrefixEdited(true) }} /></div>
            <div className="field"><label>Mobile</label>
              <input value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" />
              {fieldErr(mobile.length > 0 && !isMobile(mobile), 'Enter a 10-digit mobile number')}</div>
            <div className="field"><label>GSTIN</label>
              <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} placeholder="24ABCDE1234F1Z5" />
              {fieldErr(gstin.length > 0 && !isGstin(gstin), 'GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5')}</div>
            <div className="field"><label>PAN</label>
              <input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
              {fieldErr(pan.length > 0 && !isPan(pan), 'PAN must be 10 characters, e.g. ABCDE1234F')}</div>
            <div className="field"><label>Pincode</label>
              <PincodeField value={pincode} onChange={setPincode}
                onResolved={r => { setCity(r.city); setHomeState(r.state) }} />
              {fieldErr(pincode.length > 0 && !isPincode(pincode), '6-digit pincode')}</div>
            <div className="field"><label>City</label>
              <input value={city} onChange={e => setCity(e.target.value)} /></div>
            <div className="field full"><label>Street address</label>
              <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} /></div>
            <div className="field"><label>Home state (for tax)</label>
              <StateSelect value={homeState} onChange={setHomeState} /></div>
          </div>
        </div>

        <div className="form-actions">
          <button className="primary" disabled={!valid} onClick={start}>Start using Granule Trader</button>
        </div>
      </div>
    </div>
  )
}
