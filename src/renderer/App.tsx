import { useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import './theme.css'
import Sidebar from './components/Sidebar'
import AppRoutes from './routes'
import FirstRun from './screens/FirstRun'

export default function App() {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  useEffect(() => { window.api.needsSetup().then(n => { setNeedsSetup(n); setReady(true) }) }, [])
  if (!ready) return <div className="content">Loading…</div>
  if (needsSetup) return <FirstRun onDone={() => setNeedsSetup(false)} />
  return (
    <HashRouter>
      <div className="app"><Sidebar /><main className="content grow"><AppRoutes /></main></div>
    </HashRouter>
  )
}
