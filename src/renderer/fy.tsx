import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { financialYear } from '../main/core/financial-year'
import { today } from './lib/format'

interface FYState { fy: string; setFy: (s: string) => void; years: string[] }
const FYContext = createContext<FYState | null>(null)

export function FYProvider({ children }: { children: ReactNode }) {
  const current = financialYear(today()).label
  const [fy, setFy] = useState(current)
  const [years, setYears] = useState<string[]>([current])
  useEffect(() => {
    window.api.listFinancialYears().then(list => {
      const merged = Array.from(new Set([current, ...list])).sort().reverse()
      setYears(merged)
    }).catch(() => setYears([current]))
  }, [current])
  return <FYContext.Provider value={{ fy, setFy, years }}>{children}</FYContext.Provider>
}

export function useFY(): FYState {
  const ctx = useContext(FYContext)
  if (!ctx) throw new Error('useFY must be used within FYProvider')
  return ctx
}
