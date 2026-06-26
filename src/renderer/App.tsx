import { useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import { AppShell, Loader, Center } from '@mantine/core'
import Sidebar from './components/Sidebar'
import AppRoutes from './routes'
import FirstRun from './screens/FirstRun'
import { FYProvider } from './fy'

export default function App() {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  useEffect(() => { window.api.needsSetup().then(n => { setNeedsSetup(n); setReady(true) }) }, [])
  if (!ready) return <Center h="100vh"><Loader /></Center>
  if (needsSetup) return <FirstRun onDone={() => setNeedsSetup(false)} />
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <FYProvider>
        <AppShell navbar={{ width: 240, breakpoint: 'sm' }} padding="lg">
          <AppShell.Navbar p="md" className="no-print"><Sidebar /></AppShell.Navbar>
          <AppShell.Main><AppRoutes /></AppShell.Main>
        </AppShell>
      </FYProvider>
    </HashRouter>
  )
}
