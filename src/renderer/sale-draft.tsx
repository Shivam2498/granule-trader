import { createContext, useContext, useState, type ReactNode } from 'react'
import { today } from './lib/format'

/** What the sale draws from one lot. */
export interface LotLine { qty: number; rate: number }

export interface SaleDraft {
  /** Identifies which sale this draft belongs to ('new', 'fill:7', 'edit:7'). */
  key: string
  invoiceNumber: string
  invoiceEdited: boolean
  invoiceDate: string
  buyerId: number | null
  vehicle: string
  ewayNo: string
  ewayDate: string
  roundoff: number
  payment: 'pending' | 'done'
  paymentDate: string
  /** purchase_item_id → what we're taking from it. Insertion order is the order they were added. */
  lots: Record<number, LotLine>
}

export function emptyDraft(key: string): SaleDraft {
  return {
    key, invoiceNumber: '', invoiceEdited: false, invoiceDate: today(), buyerId: null,
    vehicle: '', ewayNo: '', ewayDate: '', roundoff: 0, payment: 'pending', paymentDate: '', lots: {}
  }
}

interface Ctx {
  draft: SaleDraft
  patch(p: Partial<SaleDraft>): void
  addLots(ids: number[]): void
  setLot(id: number, p: Partial<LotLine>): void
  removeLot(id: number): void
  reset(draft: SaleDraft): void
}

const SaleDraftContext = createContext<Ctx | null>(null)

/**
 * The sale in progress lives here rather than inside the New Sale screen, because choosing lots is
 * its own page — the user navigates away mid-sale and must come back to everything they had typed.
 */
export function SaleDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState<SaleDraft>(emptyDraft('none'))

  const value: Ctx = {
    draft,
    patch: p => setDraft(d => ({ ...d, ...p })),
    addLots: ids => setDraft(d => {
      const lots = { ...d.lots }
      for (const id of ids) if (!(id in lots)) lots[id] = { qty: 0, rate: 0 }
      return { ...d, lots }
    }),
    setLot: (id, p) => setDraft(d => ({ ...d, lots: { ...d.lots, [id]: { ...d.lots[id], ...p } } })),
    removeLot: id => setDraft(d => {
      const lots = { ...d.lots }
      delete lots[id]
      return { ...d, lots }
    }),
    reset: setDraft
  }
  return <SaleDraftContext.Provider value={value}>{children}</SaleDraftContext.Provider>
}

export function useSaleDraft(): Ctx {
  const c = useContext(SaleDraftContext)
  if (!c) throw new Error('useSaleDraft must be used inside SaleDraftProvider')
  return c
}
