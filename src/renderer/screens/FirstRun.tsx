import { useState } from 'react'
export default function FirstRun({ onDone }: { onDone: () => void }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [homeState, setHomeState] = useState('')
  const [seller, setSeller] = useState('')
  async function pick() { setFolder(await window.api.chooseDataFolder()) }
  async function save() {
    await window.api.saveSettings({ home_state: homeState.trim(), seller_name: seller.trim() })
    onDone()
  }
  return (
    <div className="content">
      <h1>Welcome</h1>
      <div className="panel">
        <p>Choose the folder where your data file will live. A cloud-synced folder (Dropbox, Google Drive, iCloud) lets a second computer use the same data — but only open it on one computer at a time.</p>
        <button onClick={pick}>Choose data folder…</button>
        {folder && <p>Selected: <b>{folder}</b></p>}
      </div>
      <div className="panel">
        <div className="field"><label>Your business name</label>
          <input value={seller} onChange={e => setSeller(e.target.value)} /></div>
        <div className="field"><label>Your home state (for tax)</label>
          <input value={homeState} onChange={e => setHomeState(e.target.value)} placeholder="e.g. Gujarat" /></div>
        <button className="primary" disabled={!folder || !homeState.trim()} onClick={save}>Start using Granule Trader</button>
      </div>
    </div>
  )
}
