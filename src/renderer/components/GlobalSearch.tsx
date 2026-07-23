import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { TextInput, Paper, Text, Group, Badge, ScrollArea } from '@mantine/core'
import { IconSearch } from '@tabler/icons-react'
import type { Sale, Purchase, Customer, Supplier, LedgerRow } from '@shared/types'
import { searchAll, flatHits, type SearchData } from '../lib/search'
import './global-search.css'

const EMPTY: SearchData = { sales: [], purchases: [], customers: [], suppliers: [], ledger: [] }

export default function GlobalSearch() {
  const nav = useNavigate()
  const [data, setData] = useState<SearchData>(EMPTY)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)   // index into the flat hit list
  const boxRef = useRef<HTMLDivElement>(null)

  // Refetch on every focus — cheap for this dataset (hundreds of rows) and keeps results current
  // with records created earlier in the same session.
  async function ensureLoaded() {
    try {
      const [sales, purchases, customers, suppliers, ledger] = await Promise.all([
        window.api.listSales() as Promise<Sale[]>,
        window.api.listPurchases() as Promise<Purchase[]>,
        window.api.listCustomers() as Promise<Customer[]>,
        window.api.listSuppliers() as Promise<Supplier[]>,
        window.api.stockLedger() as Promise<LedgerRow[]>,
      ])
      setData({ sales, purchases, customers, suppliers, ledger })
    } catch { /* leave last-known data; search simply keeps working on stale results */ }
  }

  const groups = useMemo(() => searchAll(query, data), [query, data])
  const flat = useMemo(() => flatHits(groups), [groups])
  useEffect(() => { setActive(0) }, [query])

  // Close when clicking outside.
  useEffect(() => {
    function onDoc(e: MouseEvent) { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  function go(to: string) { nav(to); setOpen(false); setQuery('') }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive(a => Math.min(a + 1, flat.length - 1)); setOpen(true) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
    else if (e.key === 'Enter') { if (flat[active]) go(flat[active].to) }
    else if (e.key === 'Escape') { setOpen(false) }
  }

  const showDropdown = open && query.trim().length >= 2

  return (
    <div className="global-search no-print" ref={boxRef}>
      <TextInput
        placeholder="Search invoices, purchases, customers, suppliers, stock…"
        leftSection={<IconSearch size={16} />}
        value={query}
        onFocus={() => { ensureLoaded(); setOpen(true) }}
        onChange={e => { setQuery(e.currentTarget.value); setOpen(true) }}
        onKeyDown={onKeyDown}
        aria-label="Global search"
      />
      {showDropdown && (
        <Paper className="global-search-results" withBorder shadow="md" radius="md">
          {flat.length === 0 ? (
            <Text c="dimmed" p="sm" size="sm">No matches for “{query.trim()}”.</Text>
          ) : (
            <ScrollArea.Autosize mah={420}>
              {groups.map(g => (
                <div key={g.group}>
                  <Text className="global-search-heading" c="dimmed" size="xs" fw={700}>{g.group}</Text>
                  {g.hits.map(h => {
                    const idx = flat.indexOf(h)
                    return (
                      <div
                        key={h.key}
                        className={'global-search-item' + (idx === active ? ' is-active' : '')}
                        onMouseEnter={() => setActive(idx)}
                        onMouseDown={e => { e.preventDefault(); go(h.to) }}
                      >
                        <Group justify="space-between" gap="sm" wrap="nowrap">
                          <Text size="sm" fw={500} truncate>{h.title}</Text>
                          <Text size="xs" c="dimmed" truncate>{h.subtitle}</Text>
                        </Group>
                      </div>
                    )
                  })}
                </div>
              ))}
            </ScrollArea.Autosize>
          )}
        </Paper>
      )}
    </div>
  )
}
