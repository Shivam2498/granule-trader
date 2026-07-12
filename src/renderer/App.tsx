import { useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import { AppShell, Loader, Center } from '@mantine/core'
import Sidebar from './components/Sidebar'
import AppRoutes from './routes'
import FirstRun from './screens/FirstRun'
import { FYProvider } from './fy'
import { SaleDraftProvider } from './sale-draft'

export default function App() {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  useEffect(() => { window.api.needsSetup().then(n => { setNeedsSetup(n); setReady(true) }) }, [])
  if (!ready) return <Center h="100vh"><Loader /></Center>
  if (needsSetup) return <FirstRun onDone={() => setNeedsSetup(false)} />
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <FYProvider>
        {/* The sale in progress lives above the router, so leaving New Sale to pick lots
            and coming back does not throw away what has been typed. */}
        <SaleDraftProvider>
          <AppShell navbar={{ width: 240, breakpoint: 'sm' }} padding="lg">
            <AppShell.Navbar p="md" className="no-print"><Sidebar /></AppShell.Navbar>
            <AppShell.Main><AppRoutes /></AppShell.Main>
          </AppShell>
        </SaleDraftProvider>
      </FYProvider>
    </HashRouter>
  )
}
