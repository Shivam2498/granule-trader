// Pure logic behind Global search: one query string across every kind of record. No React, no
// window.api. The screen loads the data once and hands it here.
import type { Sale, Purchase, Customer, Supplier, LedgerRow } from '@shared/types'
import { formatINR } from './format'

export type SearchGroup = 'Invoices' | 'Purchases' | 'Customers' | 'Suppliers' | 'Stock lots'
export interface SearchHit {
  group: SearchGroup
  key: string        // stable React key, unique across groups
  title: string
  subtitle: string
  to: string         // route to open on click
  score: number
}
export interface SearchData {
  sales: Sale[]
  purchases: Purchase[]
  customers: Customer[]
  suppliers: Supplier[]
  ledger: LedgerRow[]
}

const PER_GROUP = 8

// A hit scores by WHERE the query landed: the title (name / number) beats a buried field, and a
// match at the very start beats one in the middle. Higher is better; 0 means no match.
function score(query: string, title: string, otherFields: string[]): number {
  const q = query.toLowerCase()
  const t = title.toLowerCase()
  if (t.startsWith(q)) return 3
  if (t.includes(q)) return 2
  if (otherFields.some(f => f.toLowerCase().includes(q))) return 1
  return 0
}

function pick<T>(
  group: SearchGroup, query: string, rows: T[],
  toHit: (r: T) => { key: string; title: string; subtitle: string; to: string; fields: string[] }
): SearchHit[] {
  const hits: SearchHit[] = []
  for (const r of rows) {
    const h = toHit(r)
    const s = score(query, h.title, h.fields)
    if (s > 0) hits.push({ group, key: h.key, title: h.title, subtitle: h.subtitle, to: h.to, score: s })
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, PER_GROUP)
}

/** All groups that have at least one hit, in a fixed display order. Empty when query is under 2 chars. */
export function searchAll(query: string, data: SearchData): Array<{ group: SearchGroup; hits: SearchHit[] }> {
  const q = query.trim()
  if (q.length < 2) return []

  const groups: Array<{ group: SearchGroup; hits: SearchHit[] }> = [
    { group: 'Invoices', hits: pick('Invoices', q, data.sales.filter(s => s.status === 'created'), s => ({
      key: `sale-${s.id}`, title: s.invoice_number, subtitle: `${s.buyer_name} · ${formatINR(s.total_invoice_amount)}`,
      to: `/invoice/${s.id}`, fields: [s.buyer_name, s.buyer_gstin, String(s.total_invoice_amount)],
    })) },
    { group: 'Purchases', hits: pick('Purchases', q, data.purchases, p => ({
      key: `purchase-${p.id}`, title: p.our_code, subtitle: `${p.party}${p.supplier_invoice_number ? ' · ' + p.supplier_invoice_number : ''}`,
      to: `/purchases/edit/${p.id}`, fields: [p.party, p.supplier_invoice_number, p.hsn_code],
    })) },
    { group: 'Customers', hits: pick('Customers', q, data.customers, c => ({
      key: `customer-${c.id}`, title: c.name, subtitle: [c.billing_city, c.gstin].filter(Boolean).join(' · '),
      to: `/customers/edit/${c.id}`, fields: [c.gstin, c.phone, c.email, c.billing_city],
    })) },
    { group: 'Suppliers', hits: pick('Suppliers', q, data.suppliers, s => ({
      key: `supplier-${s.id}`, title: s.name, subtitle: [s.city, s.gstin].filter(Boolean).join(' · '),
      to: `/suppliers/edit/${s.id}`, fields: [s.gstin, s.phone, s.email, s.city],
    })) },
    { group: 'Stock lots', hits: pick('Stock lots', q, data.ledger, l => ({
      key: `lot-${l.purchase_item_id}`, title: l.our_code, subtitle: `${l.hsn_code} · ${l.balance_kg} kg · ${l.party}`,
      to: '/stock', fields: [l.hsn_code, l.party],
    })) },
  ]
  return groups.filter(g => g.hits.length > 0)
}

/** Flat list of hits in display order — for keyboard up/down navigation. */
export function flatHits(groups: Array<{ group: SearchGroup; hits: SearchHit[] }>): SearchHit[] {
  return groups.flatMap(g => g.hits)
}
