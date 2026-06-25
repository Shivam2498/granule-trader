# Dashboard Insights & CSV Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the static Dashboard with interactive, FY-scoped insight widgets and charts, and add full-GST-detail CSV export of Sales & Purchases per month and per FY.

**Architecture:** Phase A is renderer-only: pure aggregation functions in `lib/dashboard.ts` turn the already-fetched `sales`/`purchases`/`ledger` arrays into view-models that small widget components render (KPI strip, Action Center, `@mantine/charts` charts, inventory-aging table). Phase B adds a pure `lib/csv.ts` builder plus one `exportCsv` IPC (native Save dialog) wired into the month-grouped registers.

**Tech Stack:** Electron + React + TypeScript, Mantine 7, `@mantine/charts` (Recharts), better-sqlite3 (unchanged), Vitest + @testing-library/react.

## Global Constraints

- Mantine packages are pinned to `^7.17.8`; add `@mantine/charts@^7.17.8` (same minor).
- Dashboard is **FY-scoped** — widgets reflect the FY from `useFY()`; no cross-FY data.
- **Renderer-only** for Phase A: no new IPC, no main/schema change.
- Aggregation functions take `today: string` (`YYYY-MM-DD`) as a parameter — never call `new Date()` inside them — so tests are deterministic.
- Payables "due" rule: `payment_status === 'pending'` **and** `today − invoice_date > 2` (strictly greater than 2 whole days).
- Receivables: only `status === 'created'` sales with `payment_status === 'pending'`, aged by `invoice_date`.
- CSV: full GST detail, **one row per invoice/purchase**; amounts emitted as plain numbers (no `₹`, no grouping). Sales omit HSN (multi-lot); purchases include `hsn_code`.
- Money formatting in UI uses existing `formatINR` from `src/renderer/lib/format.ts`.
- Tests run under Vitest; component tests need `// @vitest-environment jsdom` and `renderWithMantine` from `tests/renderer/mantine.tsx`.
- Run the suite with `npm test` (its `pretest` rebuilds better-sqlite3 for Node). Running `npx vitest` directly after an Electron rebuild fails with a NODE_MODULE_VERSION mismatch — if so, run `npm run rebuild:node` first.

---

## Phase A — Dashboard revamp

### Task A1: Add the charts dependency

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/renderer/main.tsx:4-6` (style imports)

**Interfaces:**
- Produces: `@mantine/charts` components (`BarChart`, `DonutChart`) available to later tasks; `@mantine/charts/styles.css` loaded globally.

- [ ] **Step 1: Install the package**

Run: `npm install @mantine/charts@^7.17.8`
Expected: `package.json` gains `"@mantine/charts": "^7.17.8"` and `recharts` is added under the dependency tree.

- [ ] **Step 2: Import the chart styles**

In `src/renderer/main.tsx`, add the charts stylesheet immediately after the notifications one:

```ts
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/charts/styles.css'
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: build succeeds (no missing-module error for `@mantine/charts`).

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json src/renderer/main.tsx
git commit -m "build: add @mantine/charts for dashboard charts"
```

---

### Task A2: Money aggregations in `lib/dashboard.ts`

**Files:**
- Create: `src/renderer/lib/dashboard.ts`
- Test: `tests/renderer/dashboard.test.ts`

**Interfaces:**
- Consumes: `Sale`, `Purchase` from `@shared/types`; `monthLabel` from `./group`.
- Produces:
  - `daysBetween(date: string, today: string): number`
  - `parseState(billingJson: string): string`
  - `interface MonthPoint { key: string; label: string; salesAmt: number; salesKg: number; purchAmt: number; purchKg: number }`
  - `interface AgingBuckets { b0_30: number; b31_60: number; b60plus: number }`
  - `monthlyTrend(sales: Sale[], purchases: Purchase[]): MonthPoint[]`
  - `receivables(sales: Sale[], today: string): { total: number; buckets: AgingBuckets; overdue: Array<{ sale: Sale; daysOld: number }> }`
  - `payables(purchases: Purchase[], today: string): { total: number; buckets: AgingBuckets; due: Purchase[] }`
  - `gstSnapshot(sales: Sale[], purchases: Purchase[]): { output: number; input: number; net: number }`
  - `monthDelta(sales: Sale[], today: string): { current: number; previous: number; pct: number | null }`

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/dashboard.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { daysBetween, parseState, monthlyTrend, receivables, payables, gstSnapshot, monthDelta } from '../../src/renderer/lib/dashboard'
import type { Sale, Purchase } from '../../src/shared/types'

// Minimal builders — only the fields the functions read.
function sale(p: Partial<Sale>): Sale {
  return {
    id: 1, invoice_number: 'RP/1', prefix: 'RP', seq: 1, fy_label: '2026-27', status: 'created',
    invoice_date: '2026-06-10', eway_bill_no: null, eway_bill_date: null, vehicle: null,
    buyer_customer_id: null, buyer_name: 'Acme', buyer_gstin: '', buyer_billing_json: '{}', buyer_shipping_json: '{}',
    amount: 0, cgst: 0, sgst: 0, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 0, total_qty_kg: 0,
    payment_status: 'pending', payment_date: null, created_at: '', ...p
  } as Sale
}
function purchase(p: Partial<Purchase>): Purchase {
  return {
    id: 1, our_code: 'P1', supplier_invoice_number: 'S1', invoice_date: '2026-06-10', party: 'Supp',
    party_state: 'Gujarat', party_city: '', party_pincode: '', party_address: '', hsn_code: '3901',
    qty_kg: 0, qty_remaining_kg: 0, rate_per_kg: 0, amount: 0, cgst: 0, sgst: 0, igst: 0, tcs: 0,
    total_invoice_amount: 0, payment_status: 'pending', payment_date: null, ...p
  } as Purchase
}

describe('daysBetween', () => {
  it('counts whole days, sign reflects past vs future', () => {
    expect(daysBetween('2026-06-10', '2026-06-13')).toBe(3)
    expect(daysBetween('2026-06-13', '2026-06-13')).toBe(0)
    expect(daysBetween('2026-06-15', '2026-06-13')).toBe(-2)
  })
})

describe('parseState', () => {
  it('reads state from the billing JSON, empty on bad input', () => {
    expect(parseState('{"state":"Gujarat"}')).toBe('Gujarat')
    expect(parseState('not json')).toBe('')
    expect(parseState('{}')).toBe('')
  })
})

describe('monthlyTrend', () => {
  it('sums created sales and purchases per month, ascending', () => {
    const sales = [
      sale({ invoice_date: '2026-06-01', total_invoice_amount: 100, total_qty_kg: 10 }),
      sale({ invoice_date: '2026-05-20', total_invoice_amount: 50, total_qty_kg: 5 }),
      sale({ status: 'reserved', invoice_date: null }),
    ]
    const purchases = [purchase({ invoice_date: '2026-06-03', total_invoice_amount: 70, qty_kg: 7 })]
    const t = monthlyTrend(sales, purchases)
    expect(t.map(p => p.key)).toEqual(['2026-05', '2026-06'])
    expect(t[1]).toMatchObject({ key: '2026-06', label: 'June 2026', salesAmt: 100, salesKg: 10, purchAmt: 70, purchKg: 7 })
  })
})

describe('receivables', () => {
  it('totals pending created sales and buckets them by age', () => {
    const sales = [
      sale({ id: 1, invoice_date: '2026-06-10', total_invoice_amount: 100 }),  // 3 days → 0-30
      sale({ id: 2, invoice_date: '2026-05-01', total_invoice_amount: 200 }),  // 43 days → 31-60
      sale({ id: 3, invoice_date: '2026-03-01', total_invoice_amount: 300 }),  // >60 → 60+
      sale({ id: 4, payment_status: 'done', invoice_date: '2026-06-01', total_invoice_amount: 999 }),
      sale({ id: 5, status: 'reserved', invoice_date: null, total_invoice_amount: 999 }),
    ]
    const r = receivables(sales, '2026-06-13')
    expect(r.total).toBe(600)
    expect(r.buckets).toEqual({ b0_30: 100, b31_60: 200, b60plus: 300 })
    expect(r.overdue.map(o => o.sale.id)).toEqual([3, 2, 1])  // oldest first
  })
})

describe('payables', () => {
  it('flags purchases pending more than 2 days', () => {
    const purchases = [
      purchase({ id: 1, invoice_date: '2026-06-12', total_invoice_amount: 100 }),  // 1 day → not due
      purchase({ id: 2, invoice_date: '2026-06-11', total_invoice_amount: 200 }),  // 2 days → not due (strict >2)
      purchase({ id: 3, invoice_date: '2026-06-09', total_invoice_amount: 300 }),  // 4 days → due
      purchase({ id: 4, payment_status: 'done', invoice_date: '2026-01-01', total_invoice_amount: 999 }),
    ]
    const p = payables(purchases, '2026-06-13')
    expect(p.total).toBe(600)
    expect(p.due.map(d => d.id)).toEqual([3])
  })
})

describe('gstSnapshot', () => {
  it('nets output tax (created sales) against input tax (purchases)', () => {
    const sales = [sale({ cgst: 9, sgst: 9, igst: 0 }), sale({ status: 'reserved', cgst: 5, sgst: 5 })]
    const purchases = [purchase({ cgst: 4, sgst: 4, igst: 0 })]
    expect(gstSnapshot(sales, purchases)).toEqual({ output: 18, input: 8, net: 10 })
  })
})

describe('monthDelta', () => {
  it('compares current month to previous, null when no prior sales', () => {
    const sales = [
      sale({ invoice_date: '2026-06-05', total_invoice_amount: 150 }),
      sale({ invoice_date: '2026-05-05', total_invoice_amount: 100 }),
    ]
    expect(monthDelta(sales, '2026-06-20')).toEqual({ current: 150, previous: 100, pct: 50 })
    expect(monthDelta([sale({ invoice_date: '2026-06-05', total_invoice_amount: 150 })], '2026-06-20').pct).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer/dashboard.test.ts`
Expected: FAIL — cannot resolve `../../src/renderer/lib/dashboard`.

- [ ] **Step 3: Implement the money aggregations**

Create `src/renderer/lib/dashboard.ts`:

```ts
import type { Sale, Purchase } from '@shared/types'
import { monthLabel } from './group'

export interface MonthPoint { key: string; label: string; salesAmt: number; salesKg: number; purchAmt: number; purchKg: number }
export interface AgingBuckets { b0_30: number; b31_60: number; b60plus: number }

// Whole days from a YYYY-MM-DD date to today (today − date); negative if date is in the future.
export function daysBetween(date: string, today: string): number {
  const p = (s: string) => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d) }
  return Math.floor((p(today) - p(date)) / 86400000)
}

export function parseState(billingJson: string): string {
  try { const o = JSON.parse(billingJson); return typeof o?.state === 'string' ? o.state : '' } catch { return '' }
}

export function monthlyTrend(sales: Sale[], purchases: Purchase[]): MonthPoint[] {
  const acc = new Map<string, MonthPoint>()
  const at = (k: string): MonthPoint => {
    const e = acc.get(k) ?? { key: k, label: monthLabel(k), salesAmt: 0, salesKg: 0, purchAmt: 0, purchKg: 0 }
    acc.set(k, e); return e
  }
  for (const s of sales) {
    if (s.status !== 'created' || !s.invoice_date) continue
    const e = at(s.invoice_date.slice(0, 7)); e.salesAmt += s.total_invoice_amount; e.salesKg += s.total_qty_kg
  }
  for (const p of purchases) {
    const e = at(p.invoice_date.slice(0, 7)); e.purchAmt += p.total_invoice_amount; e.purchKg += p.qty_kg
  }
  return [...acc.values()].sort((a, b) => a.key.localeCompare(b.key))
}

function bucketize(items: Array<{ amt: number; days: number }>): AgingBuckets {
  const b: AgingBuckets = { b0_30: 0, b31_60: 0, b60plus: 0 }
  for (const it of items) {
    if (it.days <= 30) b.b0_30 += it.amt
    else if (it.days <= 60) b.b31_60 += it.amt
    else b.b60plus += it.amt
  }
  return b
}

export function receivables(sales: Sale[], today: string) {
  const pend = sales.filter(s => s.status === 'created' && s.payment_status === 'pending' && s.invoice_date)
  const total = pend.reduce((a, s) => a + s.total_invoice_amount, 0)
  const buckets = bucketize(pend.map(s => ({ amt: s.total_invoice_amount, days: daysBetween(s.invoice_date!, today) })))
  const overdue = pend
    .map(s => ({ sale: s, daysOld: daysBetween(s.invoice_date!, today) }))
    .sort((a, b) => b.daysOld - a.daysOld)
  return { total, buckets, overdue }
}

export function payables(purchases: Purchase[], today: string) {
  const pend = purchases.filter(p => p.payment_status === 'pending')
  const total = pend.reduce((a, p) => a + p.total_invoice_amount, 0)
  const buckets = bucketize(pend.map(p => ({ amt: p.total_invoice_amount, days: daysBetween(p.invoice_date, today) })))
  const due = pend
    .filter(p => daysBetween(p.invoice_date, today) > 2)
    .sort((a, b) => daysBetween(b.invoice_date, today) - daysBetween(a.invoice_date, today))
  return { total, buckets, due }
}

export function gstSnapshot(sales: Sale[], purchases: Purchase[]) {
  const created = sales.filter(s => s.status === 'created')
  const output = created.reduce((a, s) => a + s.cgst + s.sgst + s.igst, 0)
  const input = purchases.reduce((a, p) => a + p.cgst + p.sgst + p.igst, 0)
  return { output, input, net: output - input }
}

export function monthDelta(sales: Sale[], today: string) {
  const created = sales.filter(s => s.status === 'created' && s.invoice_date)
  const cur = today.slice(0, 7)
  const [y, m] = cur.split('-').map(Number)
  const pd = new Date(Date.UTC(y, m - 2, 1))
  const prev = `${pd.getUTCFullYear()}-${String(pd.getUTCMonth() + 1).padStart(2, '0')}`
  const sum = (mk: string) => created.filter(s => s.invoice_date!.slice(0, 7) === mk).reduce((a, s) => a + s.total_invoice_amount, 0)
  const current = sum(cur), previous = sum(prev)
  return { current, previous, pct: previous === 0 ? null : ((current - previous) / previous) * 100 }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/dashboard.test.ts`
Expected: PASS (all describe blocks above).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/dashboard.ts tests/renderer/dashboard.test.ts
git commit -m "feat: money aggregations for dashboard (trend, receivables, payables, GST)"
```

---

### Task A3: Inventory aggregations in `lib/dashboard.ts`

**Files:**
- Modify: `src/renderer/lib/dashboard.ts`
- Modify: `tests/renderer/dashboard.test.ts`

**Interfaces:**
- Consumes: `LedgerRow`, `Purchase`, `Sale` from `@shared/types`; `daysBetween` from Task A2.
- Produces:
  - `interface StockSlice { hsn: string; kg: number; value: number }`
  - `interface AgeBucket { bucket: '0-30' | '31-60' | '61-90' | '90+'; kg: number; value: number }`
  - `stockByProduct(ledger: LedgerRow[], purchases: Purchase[]): StockSlice[]`
  - `inventoryAging(ledger: LedgerRow[], purchases: Purchase[], today: string): AgeBucket[]`
  - `lowStock(ledger: LedgerRow[], threshold: number): LedgerRow[]`
  - `reservedPendingFill(sales: Sale[]): Sale[]`

- [ ] **Step 1: Write the failing tests**

Append to `tests/renderer/dashboard.test.ts` (add to the existing imports: `stockByProduct, inventoryAging, lowStock, reservedPendingFill` and `import type { LedgerRow } from '../../src/shared/types'`):

```ts
function ledger(p: Partial<LedgerRow>): LedgerRow {
  return { purchase_id: 1, our_code: 'P1', hsn_code: '3901', party: 'Supp', invoice_date: '2026-06-10', qty_kg: 0, consumed_kg: 0, balance_kg: 0, ...p } as LedgerRow
}

describe('stockByProduct', () => {
  it('groups balance by HSN and values it via the purchase rate', () => {
    const rows = [
      ledger({ purchase_id: 1, hsn_code: '3901', balance_kg: 100 }),
      ledger({ purchase_id: 2, hsn_code: '3901', balance_kg: 50 }),
      ledger({ purchase_id: 3, hsn_code: '3902', balance_kg: 10 }),
      ledger({ purchase_id: 4, hsn_code: '3902', balance_kg: 0 }),   // skipped (no balance)
    ]
    const purchases = [purchase({ id: 1, rate_per_kg: 2 }), purchase({ id: 2, rate_per_kg: 4 }), purchase({ id: 3, rate_per_kg: 5 })]
    const slices = stockByProduct(rows, purchases)
    expect(slices).toEqual([
      { hsn: '3901', kg: 150, value: 100 * 2 + 50 * 4 },   // 400, sorted first by value
      { hsn: '3902', kg: 10, value: 50 },
    ])
  })
})

describe('inventoryAging', () => {
  it('buckets remaining lots by age with rupee value', () => {
    const rows = [
      ledger({ purchase_id: 1, invoice_date: '2026-06-10', balance_kg: 10 }),  // 3 days → 0-30
      ledger({ purchase_id: 2, invoice_date: '2026-03-01', balance_kg: 20 }),  // >90 → 90+
    ]
    const purchases = [purchase({ id: 1, rate_per_kg: 2 }), purchase({ id: 2, rate_per_kg: 3 })]
    const buckets = inventoryAging(rows, purchases, '2026-06-13')
    expect(buckets.map(b => b.bucket)).toEqual(['0-30', '31-60', '61-90', '90+'])
    expect(buckets[0]).toEqual({ bucket: '0-30', kg: 10, value: 20 })
    expect(buckets[3]).toEqual({ bucket: '90+', kg: 20, value: 60 })
  })
})

describe('lowStock', () => {
  it('returns lots below the threshold', () => {
    const rows = [ledger({ our_code: 'A', balance_kg: 100 }), ledger({ our_code: 'B', balance_kg: 600 })]
    expect(lowStock(rows, 500).map(r => r.our_code)).toEqual(['A'])
  })
})

describe('reservedPendingFill', () => {
  it('returns only reserved sales', () => {
    const sales = [sale({ id: 1, status: 'created' }), sale({ id: 2, status: 'reserved', invoice_date: null })]
    expect(reservedPendingFill(sales).map(s => s.id)).toEqual([2])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer/dashboard.test.ts`
Expected: FAIL — `stockByProduct` (and the others) are not exported.

- [ ] **Step 3: Implement the inventory aggregations**

Append to `src/renderer/lib/dashboard.ts` (add `LedgerRow` to the type import):

```ts
import type { Sale, Purchase, LedgerRow } from '@shared/types'

export interface StockSlice { hsn: string; kg: number; value: number }
export interface AgeBucket { bucket: '0-30' | '31-60' | '61-90' | '90+'; kg: number; value: number }

function purchaseMap(purchases: Purchase[]): Map<number, Purchase> {
  return new Map(purchases.map(p => [p.id, p]))
}

export function stockByProduct(ledger: LedgerRow[], purchases: Purchase[]): StockSlice[] {
  const pm = purchaseMap(purchases)
  const by = new Map<string, StockSlice>()
  for (const r of ledger) {
    if (r.balance_kg <= 0) continue
    const rate = pm.get(r.purchase_id)?.rate_per_kg ?? 0
    const e = by.get(r.hsn_code) ?? { hsn: r.hsn_code, kg: 0, value: 0 }
    e.kg += r.balance_kg; e.value += r.balance_kg * rate; by.set(r.hsn_code, e)
  }
  return [...by.values()].sort((a, b) => b.value - a.value)
}

export function inventoryAging(ledger: LedgerRow[], purchases: Purchase[], today: string): AgeBucket[] {
  const pm = purchaseMap(purchases)
  const b: Record<AgeBucket['bucket'], AgeBucket> = {
    '0-30': { bucket: '0-30', kg: 0, value: 0 },
    '31-60': { bucket: '31-60', kg: 0, value: 0 },
    '61-90': { bucket: '61-90', kg: 0, value: 0 },
    '90+': { bucket: '90+', kg: 0, value: 0 },
  }
  for (const r of ledger) {
    if (r.balance_kg <= 0) continue
    const days = daysBetween(r.invoice_date, today)
    const rate = pm.get(r.purchase_id)?.rate_per_kg ?? 0
    const k: AgeBucket['bucket'] = days <= 30 ? '0-30' : days <= 60 ? '31-60' : days <= 90 ? '61-90' : '90+'
    b[k].kg += r.balance_kg; b[k].value += r.balance_kg * rate
  }
  return [b['0-30'], b['31-60'], b['61-90'], b['90+']]
}

export function lowStock(ledger: LedgerRow[], threshold: number): LedgerRow[] {
  return ledger.filter(r => r.balance_kg < threshold)
}

export function reservedPendingFill(sales: Sale[]): Sale[] {
  return sales.filter(s => s.status === 'reserved')
}
```

Note: replace the existing `import type { Sale, Purchase } from '@shared/types'` line from Task A2 with the three-type version above (do not leave two import lines).

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/dashboard.test.ts`
Expected: PASS (all blocks).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/dashboard.ts tests/renderer/dashboard.test.ts
git commit -m "feat: inventory aggregations for dashboard (stock by product, aging, low stock, reserved)"
```

---

### Task A4: Action Center component

**Files:**
- Create: `src/renderer/components/dashboard/ActionCenter.tsx`
- Test: `tests/renderer/action-center.test.tsx`

**Interfaces:**
- Consumes: `receivables`, `payables`, `reservedPendingFill`, `lowStock` outputs from `lib/dashboard.ts`; `formatINR` from `lib/format`; `useNavigate` from `react-router-dom`.
- Produces: `default function ActionCenter(props: ActionCenterProps)` where
  `interface ActionCenterProps { dueP: Purchase[]; overdue: Array<{ sale: Sale; daysOld: number }>; reserved: Sale[]; lowLots: LedgerRow[] }`

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/action-center.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import ActionCenter from '../../src/renderer/components/dashboard/ActionCenter'
import type { Sale, Purchase, LedgerRow } from '../../src/shared/types'

const p = (o: Partial<Purchase>) => ({ id: 1, our_code: 'P1', party: 'Supp', invoice_date: '2026-06-01', total_invoice_amount: 500, payment_status: 'pending' } as Purchase)
const s = (o: Partial<Sale>) => ({ id: 7, invoice_number: 'RP/7', buyer_name: 'Acme', total_invoice_amount: 900, status: 'reserved' } as Sale)
const l = (o: Partial<LedgerRow>) => ({ purchase_id: 1, our_code: 'L1', hsn_code: '3901', balance_kg: 100, ...o } as LedgerRow)

describe('ActionCenter', () => {
  it('shows counts and items for each action group', () => {
    renderWithMantine(
      <HashRouter>
        <ActionCenter
          dueP={[p({})]}
          overdue={[{ sale: { id: 7, invoice_number: 'RP/7', buyer_name: 'Acme', total_invoice_amount: 900 } as Sale, daysOld: 40 }]}
          reserved={[s({})]}
          lowLots={[l({ our_code: 'L1' })]}
        />
      </HashRouter>
    )
    expect(screen.getByText('Payables due (>2 days)')).toBeTruthy()
    expect(screen.getByText('Overdue receivables')).toBeTruthy()
    expect(screen.getByText('Reserved invoices')).toBeTruthy()
    expect(screen.getByText('Low stock')).toBeTruthy()
    expect(screen.getByText('RP/7')).toBeTruthy()   // overdue invoice number rendered
    expect(screen.getByText('L1')).toBeTruthy()      // low-stock lot rendered
  })

  it('renders empty copy when a group has no items', () => {
    renderWithMantine(<HashRouter><ActionCenter dueP={[]} overdue={[]} reserved={[]} lowLots={[]} /></HashRouter>)
    expect(screen.getAllByText('Nothing here.').length).toBe(4)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/renderer/action-center.test.tsx`
Expected: FAIL — cannot resolve `ActionCenter`.

- [ ] **Step 3: Implement the component**

Create `src/renderer/components/dashboard/ActionCenter.tsx`:

```tsx
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { SimpleGrid, Paper, Group, Text, Badge, UnstyledButton, Stack } from '@mantine/core'
import type { Sale, Purchase, LedgerRow } from '@shared/types'
import { formatINR } from '../../lib/format'

interface ActionCenterProps {
  dueP: Purchase[]
  overdue: Array<{ sale: Sale; daysOld: number }>
  reserved: Sale[]
  lowLots: LedgerRow[]
}

function Card({ title, count, accent, children }: { title: string; count: number; accent: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{title}</Text>
        <Badge color={accent}>{count}</Badge>
      </Group>
      <Stack gap={4}>{children}</Stack>
    </Paper>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <UnstyledButton onClick={onClick} style={{ display: 'block', width: '100%' }}>
      <Text size="sm" style={{ cursor: 'pointer' }}>{children}</Text>
    </UnstyledButton>
  )
}

const empty = <Text size="sm" c="dimmed">Nothing here.</Text>

export default function ActionCenter({ dueP, overdue, reserved, lowLots }: ActionCenterProps) {
  const nav = useNavigate()
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} mb="lg">
      <Card title="Payables due (>2 days)" count={dueP.length} accent="red">
        {dueP.length === 0 ? empty : dueP.map(p =>
          <Row key={p.id} onClick={() => nav(`/purchases/edit/${p.id}`)}>{p.our_code} · {p.party} · {formatINR(p.total_invoice_amount)}</Row>)}
      </Card>
      <Card title="Overdue receivables" count={overdue.length} accent="orange">
        {overdue.length === 0 ? empty : overdue.map(o =>
          <Row key={o.sale.id} onClick={() => nav(`/invoice/${o.sale.id}`)}>{o.sale.invoice_number} · {o.sale.buyer_name} · {formatINR(o.sale.total_invoice_amount)} · {o.daysOld}d</Row>)}
      </Card>
      <Card title="Reserved invoices" count={reserved.length} accent="yellow">
        {reserved.length === 0 ? empty : reserved.map(s =>
          <Row key={s.id} onClick={() => nav(`/sales/fill/${s.id}`)}>{s.invoice_number} · waiting to fill</Row>)}
      </Card>
      <Card title="Low stock" count={lowLots.length} accent="blue">
        {lowLots.length === 0 ? empty : lowLots.map(r =>
          <Row key={r.purchase_id} onClick={() => nav('/stock')}>{r.our_code} ({r.hsn_code}) · {r.balance_kg} kg</Row>)}
      </Card>
    </SimpleGrid>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- tests/renderer/action-center.test.tsx`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/dashboard/ActionCenter.tsx tests/renderer/action-center.test.tsx
git commit -m "feat: interactive Action Center widget for dashboard"
```

---

### Task A5: Chart & inventory-aging widgets

**Files:**
- Create: `src/renderer/components/dashboard/TrendChart.tsx`
- Create: `src/renderer/components/dashboard/StockDonut.tsx`
- Create: `src/renderer/components/dashboard/AgingChart.tsx`
- Create: `src/renderer/components/dashboard/InventoryAgingTable.tsx`

**Interfaces:**
- Consumes: `MonthPoint`, `StockSlice`, `AgeBucket`, `AgingBuckets` from `lib/dashboard`; `formatINR` from `lib/format`; `BarChart`, `DonutChart` from `@mantine/charts`.
- Produces:
  - `TrendChart({ data }: { data: MonthPoint[] })`
  - `StockDonut({ data }: { data: StockSlice[] })`
  - `AgingChart({ receivables, payables }: { receivables: AgingBuckets; payables: AgingBuckets })`
  - `InventoryAgingTable({ buckets }: { buckets: AgeBucket[] })`

These are presentational chart wrappers verified by typecheck + build + operator pass (Recharts renders nothing meaningful in jsdom, so no unit test).

- [ ] **Step 1: Implement `TrendChart`**

Create `src/renderer/components/dashboard/TrendChart.tsx`:

```tsx
import { useState } from 'react'
import { Paper, Group, Title, SegmentedControl, Text } from '@mantine/core'
import { BarChart } from '@mantine/charts'
import type { MonthPoint } from '../../lib/dashboard'

export default function TrendChart({ data }: { data: MonthPoint[] }) {
  const [mode, setMode] = useState<'amt' | 'kg'>('amt')
  const series = mode === 'amt'
    ? [{ name: 'salesAmt', label: 'Sales ₹', color: 'teal.6' }, { name: 'purchAmt', label: 'Purchases ₹', color: 'blue.6' }]
    : [{ name: 'salesKg', label: 'Sales kg', color: 'teal.6' }, { name: 'purchKg', label: 'Purchases kg', color: 'blue.6' }]
  return (
    <Paper withBorder p="lg" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Sales vs Purchases</Title>
        <SegmentedControl size="xs" value={mode} onChange={v => setMode(v as 'amt' | 'kg')}
          data={[{ label: '₹', value: 'amt' }, { label: 'kg', value: 'kg' }]} />
      </Group>
      {data.length === 0 ? <Text c="dimmed">No activity this year yet.</Text> :
        <BarChart h={260} data={data} dataKey="label" series={series} withLegend tickLine="y" />}
    </Paper>
  )
}
```

- [ ] **Step 2: Implement `StockDonut`**

Create `src/renderer/components/dashboard/StockDonut.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { Paper, Title, Text } from '@mantine/core'
import { DonutChart } from '@mantine/charts'
import type { StockSlice } from '../../lib/dashboard'

const PALETTE = ['teal.6', 'blue.6', 'grape.6', 'orange.6', 'cyan.6', 'lime.6', 'pink.6', 'indigo.6']

export default function StockDonut({ data }: { data: StockSlice[] }) {
  const nav = useNavigate()
  const chartData = data.map((s, i) => ({ name: s.hsn, value: Math.round(s.kg), color: PALETTE[i % PALETTE.length] }))
  return (
    <Paper withBorder p="lg" radius="md" onClick={() => nav('/stock')} style={{ cursor: 'pointer' }}>
      <Title order={3} mb="md">Stock by product (kg)</Title>
      {chartData.length === 0 ? <Text c="dimmed">No stock on hand.</Text> :
        <DonutChart h={240} data={chartData} withLabels withTooltip />}
    </Paper>
  )
}
```

- [ ] **Step 3: Implement `AgingChart`**

Create `src/renderer/components/dashboard/AgingChart.tsx`:

```tsx
import { Paper, Title } from '@mantine/core'
import { BarChart } from '@mantine/charts'
import type { AgingBuckets } from '../../lib/dashboard'

export default function AgingChart({ receivables, payables }: { receivables: AgingBuckets; payables: AgingBuckets }) {
  const data = [
    { bucket: '0–30 days', Receivables: receivables.b0_30, Payables: payables.b0_30 },
    { bucket: '31–60 days', Receivables: receivables.b31_60, Payables: payables.b31_60 },
    { bucket: '60+ days', Receivables: receivables.b60plus, Payables: payables.b60plus },
  ]
  return (
    <Paper withBorder p="lg" radius="md">
      <Title order={3} mb="md">Receivables & Payables aging</Title>
      <BarChart h={240} data={data} dataKey="bucket" withLegend
        series={[{ name: 'Receivables', color: 'orange.6' }, { name: 'Payables', color: 'red.6' }]} />
    </Paper>
  )
}
```

- [ ] **Step 4: Implement `InventoryAgingTable`**

Create `src/renderer/components/dashboard/InventoryAgingTable.tsx`:

```tsx
import { useNavigate } from 'react-router-dom'
import { Paper, Title, Table } from '@mantine/core'
import type { AgeBucket } from '../../lib/dashboard'
import { formatINR } from '../../lib/format'

export default function InventoryAgingTable({ buckets }: { buckets: AgeBucket[] }) {
  const nav = useNavigate()
  return (
    <Paper withBorder p="lg" radius="md" mb="md">
      <Title order={3} mb="md">Inventory aging — capital tied up</Title>
      <Table highlightOnHover>
        <Table.Thead><Table.Tr><Table.Th>Age</Table.Th><Table.Th ta="right">Qty (kg)</Table.Th><Table.Th ta="right">Value</Table.Th></Table.Tr></Table.Thead>
        <Table.Tbody>
          {buckets.map(b => (
            <Table.Tr key={b.bucket} style={{ cursor: 'pointer' }} onClick={() => nav('/stock')}>
              <Table.Td>{b.bucket} days</Table.Td>
              <Table.Td ta="right">{Math.round(b.kg)}</Table.Td>
              <Table.Td ta="right">{formatINR(b.value)}</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  )
}
```

- [ ] **Step 5: Verify typecheck & build**

Run: `npm run typecheck && npm run build`
Expected: both succeed.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/components/dashboard/
git commit -m "feat: dashboard chart widgets (trend, stock donut, aging, inventory table)"
```

---

### Task A6: Assemble the Dashboard

**Files:**
- Modify: `src/renderer/components/KpiCard.tsx` (add optional `onClick` + `sub`)
- Modify: `src/renderer/screens/Dashboard.tsx` (full rewrite of the body)

**Interfaces:**
- Consumes: every export from `lib/dashboard`, all four widgets from `components/dashboard/`, `KpiCard`, `formatINR`, `today` from `lib/format`, `useFY`.
- Produces: the rendered Dashboard screen (no exported API).

- [ ] **Step 1: Extend `KpiCard` with click + sub-text**

Replace `src/renderer/components/KpiCard.tsx` with:

```tsx
import type { ReactNode } from 'react'
import { Paper, Text } from '@mantine/core'
export default function KpiCard({ label, value, sub, onClick }: { label: string; value: string; sub?: ReactNode; onClick?: () => void }) {
  return (
    <Paper withBorder p="lg" radius="md" onClick={onClick}
      style={{ flex: 1, minWidth: 200, cursor: onClick ? 'pointer' : undefined }}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="28px">{value}</Text>
      {sub && <Text size="sm">{sub}</Text>}
    </Paper>
  )
}
```

(This is backward compatible — existing `<KpiCard label value />` calls keep working.)

- [ ] **Step 2: Rewrite `Dashboard.tsx`**

Replace `src/renderer/screens/Dashboard.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Group, Button, Alert, Text, SimpleGrid } from '@mantine/core'
import type { Sale, Purchase, LedgerRow, Settings } from '@shared/types'
import KpiCard from '../components/KpiCard'
import PageHeader from '../components/PageHeader'
import ActionCenter from '../components/dashboard/ActionCenter'
import TrendChart from '../components/dashboard/TrendChart'
import StockDonut from '../components/dashboard/StockDonut'
import AgingChart from '../components/dashboard/AgingChart'
import InventoryAgingTable from '../components/dashboard/InventoryAgingTable'
import { formatINR, today } from '../lib/format'
import {
  monthlyTrend, receivables, payables, gstSnapshot, monthDelta,
  stockByProduct, inventoryAging, lowStock, reservedPendingFill
} from '../lib/dashboard'
import { useFY } from '../fy'

export default function Dashboard() {
  const nav = useNavigate()
  const { fy } = useFY()
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      setSales(await window.api.listSales(fy)); setPurchases(await window.api.listPurchases(fy))
      setLedger(await window.api.stockLedger()); setSettings(await window.api.getSettings())
    } catch (e: any) { setError('Could not load dashboard: ' + (e.message ?? e)) }
  })() }, [fy])

  const now = today()
  const trend = monthlyTrend(sales, purchases)
  const rec = receivables(sales, now)
  const pay = payables(purchases, now)
  const gst = gstSnapshot(sales, purchases)
  const delta = monthDelta(sales, now)
  const stock = stockByProduct(ledger, purchases)
  const aging = inventoryAging(ledger, purchases, now)
  const lowLots = lowStock(ledger, settings?.low_stock_threshold ?? 0)
  const reserved = reservedPendingFill(sales)

  const salesFy = sales.filter(s => s.status === 'created').reduce((a, s) => a + s.total_invoice_amount, 0)
  const stockKg = ledger.reduce((a, r) => a + r.balance_kg, 0)
  const stockValue = stock.reduce((a, s) => a + s.value, 0)
  const deltaText = delta.pct === null ? null
    : <Text span c={delta.pct >= 0 ? 'teal' : 'red'}>{delta.pct >= 0 ? '▲' : '▼'} {Math.abs(delta.pct).toFixed(0)}% vs last month</Text>

  return (
    <div>
      <PageHeader title={`Welcome${settings?.seller_name ? `, ${settings.seller_name}` : ''}`} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Text c="dimmed" mb="md">{now}</Text>
      <Group mb="lg">
        <Button size="lg" onClick={() => nav('/sales/new')}>New sale</Button>
        <Button size="lg" variant="default" onClick={() => nav('/purchases/new')}>New purchase</Button>
      </Group>

      <Group align="stretch" mb="lg">
        <KpiCard label={`Sales · ${fy}`} value={formatINR(salesFy)} sub={deltaText} onClick={() => nav('/sales')} />
        <KpiCard label="Receivables outstanding" value={formatINR(rec.total)} sub={`${rec.overdue.length} pending`} />
        <KpiCard label="Stock on hand" value={`${stockKg} kg`} sub={formatINR(stockValue)} onClick={() => nav('/stock')} />
        <KpiCard label={`Net GST payable · ${fy}`} value={formatINR(gst.net)} sub={`out ${formatINR(gst.output)} − in ${formatINR(gst.input)}`} />
      </Group>

      <ActionCenter dueP={pay.due} overdue={rec.overdue} reserved={reserved} lowLots={lowLots} />

      <SimpleGrid cols={{ base: 1, md: 2 }} mb="md">
        <TrendChart data={trend} />
        <StockDonut data={stock} />
      </SimpleGrid>
      <SimpleGrid cols={{ base: 1 }} mb="md">
        <AgingChart receivables={rec.buckets} payables={pay.buckets} />
      </SimpleGrid>

      <InventoryAgingTable buckets={aging} />
    </div>
  )
}
```

- [ ] **Step 3: Verify typecheck, tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; full suite green (the pre-existing `scrollIntoView` unhandled error in `fy.test.tsx` is unrelated); build succeeds.

- [ ] **Step 4: Operator pass**

Run: `npm run rebuild:electron && npm run dev`
Expected: Dashboard shows KPI cards with ▲▼ deltas; Action Center rows navigate (payable→purchase edit, overdue→invoice, reserved→fill, low stock→stock); Trend chart toggles ₹/kg; Stock donut and aging chart render; switching FY in the sidebar re-computes all widgets.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/KpiCard.tsx src/renderer/screens/Dashboard.tsx
git commit -m "feat: interactive insight dashboard (KPIs, action center, charts)"
```

---

## Phase B — CSV export

### Task B1: CSV builder & column definitions

**Files:**
- Create: `src/renderer/lib/csv.ts`
- Test: `tests/renderer/csv.test.ts`

**Interfaces:**
- Consumes: `Sale`, `Purchase` from `@shared/types`; `parseState` from `./dashboard`.
- Produces:
  - `interface CsvColumn<T> { header: string; value: (row: T) => string | number }`
  - `toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string`
  - `salesColumns: CsvColumn<Sale>[]`
  - `purchaseColumns: CsvColumn<Purchase>[]`

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/csv.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { toCsv, salesColumns, purchaseColumns } from '../../src/renderer/lib/csv'
import type { Sale, Purchase } from '../../src/shared/types'

describe('toCsv', () => {
  it('joins headers and rows, escaping quotes/commas/newlines', () => {
    const cols = [
      { header: 'Name', value: (r: { n: string; v: number }) => r.n },
      { header: 'Val', value: (r: { n: string; v: number }) => r.v },
    ]
    const out = toCsv([{ n: 'Plain', v: 1 }, { n: 'Has, comma', v: 2 }, { n: 'Quote"x', v: 3 }], cols)
    expect(out).toBe('Name,Val\nPlain,1\n"Has, comma",2\n"Quote""x",3')
  })
  it('returns just the header row for no data', () => {
    expect(toCsv([], [{ header: 'A', value: () => '' }])).toBe('A')
  })
})

describe('salesColumns', () => {
  it('maps invoice-level GST fields and reads buyer state from JSON', () => {
    const s = { invoice_number: 'RP/1', invoice_date: '2026-06-10', buyer_name: 'Acme', buyer_gstin: '24X',
      buyer_billing_json: '{"state":"Gujarat"}', total_qty_kg: 5, amount: 100, cgst: 9, sgst: 9, igst: 0, tcs: 0,
      roundoff: 0, total_invoice_amount: 118, payment_status: 'pending', payment_date: null } as Sale
    const row = salesColumns.map(c => c.value(s))
    expect(row).toEqual(['RP/1', '2026-06-10', 'Acme', '24X', 'Gujarat', 5, 100, 9, 9, 0, 0, 0, 118, 'pending', ''])
    expect(salesColumns.map(c => c.header)).toContain('Buyer GSTIN')
  })
})

describe('purchaseColumns', () => {
  it('maps purchase GST fields including HSN', () => {
    const p = { our_code: 'P1', supplier_invoice_number: 'S1', invoice_date: '2026-06-10', party: 'Supp',
      party_state: 'Gujarat', hsn_code: '3901', qty_kg: 10, rate_per_kg: 50, amount: 500, cgst: 45, sgst: 45,
      igst: 0, tcs: 0, total_invoice_amount: 590, payment_status: 'done', payment_date: '2026-06-12' } as Purchase
    const row = purchaseColumns.map(c => c.value(p))
    expect(row).toEqual(['P1', 'S1', '2026-06-10', 'Supp', 'Gujarat', '3901', 10, 50, 500, 45, 45, 0, 0, 590, 'done', '2026-06-12'])
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/renderer/csv.test.ts`
Expected: FAIL — cannot resolve `../../src/renderer/lib/csv`.

- [ ] **Step 3: Implement the CSV module**

Create `src/renderer/lib/csv.ts`:

```ts
import type { Sale, Purchase } from '@shared/types'
import { parseState } from './dashboard'

export interface CsvColumn<T> { header: string; value: (row: T) => string | number }

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string {
  const esc = (v: string | number): string => {
    const s = String(v)
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
  }
  const head = columns.map(c => esc(c.header)).join(',')
  const body = rows.map(r => columns.map(c => esc(c.value(r))).join(',')).join('\n')
  return body ? head + '\n' + body : head
}

export const salesColumns: CsvColumn<Sale>[] = [
  { header: 'Invoice No', value: s => s.invoice_number },
  { header: 'Date', value: s => s.invoice_date ?? '' },
  { header: 'Buyer', value: s => s.buyer_name },
  { header: 'Buyer GSTIN', value: s => s.buyer_gstin },
  { header: 'State', value: s => parseState(s.buyer_billing_json) },
  { header: 'Qty (kg)', value: s => s.total_qty_kg },
  { header: 'Taxable', value: s => s.amount },
  { header: 'CGST', value: s => s.cgst },
  { header: 'SGST', value: s => s.sgst },
  { header: 'IGST', value: s => s.igst },
  { header: 'TCS', value: s => s.tcs },
  { header: 'Round-off', value: s => s.roundoff },
  { header: 'Total', value: s => s.total_invoice_amount },
  { header: 'Payment status', value: s => s.payment_status },
  { header: 'Payment date', value: s => s.payment_date ?? '' },
]

export const purchaseColumns: CsvColumn<Purchase>[] = [
  { header: 'Code', value: p => p.our_code },
  { header: 'Supplier Inv No', value: p => p.supplier_invoice_number },
  { header: 'Date', value: p => p.invoice_date },
  { header: 'Supplier', value: p => p.party },
  { header: 'State', value: p => p.party_state },
  { header: 'HSN', value: p => p.hsn_code },
  { header: 'Qty (kg)', value: p => p.qty_kg },
  { header: 'Rate', value: p => p.rate_per_kg },
  { header: 'Taxable', value: p => p.amount },
  { header: 'CGST', value: p => p.cgst },
  { header: 'SGST', value: p => p.sgst },
  { header: 'IGST', value: p => p.igst },
  { header: 'TCS', value: p => p.tcs },
  { header: 'Total', value: p => p.total_invoice_amount },
  { header: 'Payment status', value: p => p.payment_status },
  { header: 'Payment date', value: p => p.payment_date ?? '' },
]
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/renderer/csv.test.ts`
Expected: PASS (all three describe blocks).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/csv.ts tests/renderer/csv.test.ts
git commit -m "feat: CSV builder + full-GST sales/purchase column sets"
```

---

### Task B2: `exportCsv` IPC

**Files:**
- Modify: `src/shared/api.ts` (Api interface + CHANNELS)
- Modify: `tests/core/api-shape.test.ts` (API_METHODS list)
- Modify: `src/main/ipc.ts` (import `writeFileSync`, add handler)

**Interfaces:**
- Produces: `window.api.exportCsv(suggestedName: string, content: string): Promise<{ saved: boolean; path?: string }>` (preload auto-bridges it via the `CHANNELS` loop — no preload edit needed).

- [ ] **Step 1: Update the api-shape guard test (now failing)**

In `tests/core/api-shape.test.ts`, add `'exportCsv'` to the end of the `API_METHODS` array:

```ts
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listSuppliers','createSupplier','updateSupplier','deleteSupplier','listHsn','upsertHsn','listFinancialYears','exportCsv'
```

- [ ] **Step 2: Run the guard test to verify it fails**

Run: `npm test -- tests/core/api-shape.test.ts`
Expected: FAIL — `CHANNELS` does not contain `exportCsv`.

- [ ] **Step 3: Declare the channel & Api method**

In `src/shared/api.ts`, add to the `Api` interface (after `backupNow`):

```ts
  exportCsv(suggestedName: string, content: string): Promise<{ saved: boolean; path?: string }>
```

And append `'exportCsv'` to the `CHANNELS` array (end of the bootstrap/settings line is fine):

```ts
  'needsSetup','chooseDataFolder','getSettings','saveSettings','backupNow','exportCsv',
```

- [ ] **Step 4: Run the guard test to verify it passes**

Run: `npm test -- tests/core/api-shape.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the main handler**

In `src/main/ipc.ts`, add the fs import near the top imports:

```ts
import { writeFileSync } from 'fs'
```

Then add the handler next to `chooseDataFolder` (after the `saveSettings` handler):

```ts
  h('exportCsv', async (suggestedName: string, content: string) => {
    const r = await dialog.showSaveDialog({ defaultPath: suggestedName, filters: [{ name: 'CSV', extensions: ['csv'] }] })
    if (r.canceled || !r.filePath) return { saved: false }
    writeFileSync(r.filePath, content, 'utf8')
    return { saved: true, path: r.filePath }
  })
```

- [ ] **Step 6: Verify typecheck & full suite**

Run: `npm run typecheck && npm test`
Expected: typecheck clean; suite green.

- [ ] **Step 7: Commit**

```bash
git add src/shared/api.ts tests/core/api-shape.test.ts src/main/ipc.ts
git commit -m "feat: exportCsv IPC with native save dialog"
```

---

### Task B3: Export buttons on the registers

**Files:**
- Modify: `src/renderer/screens/Sales.tsx`
- Modify: `src/renderer/screens/Purchases.tsx`

**Interfaces:**
- Consumes: `toCsv`, `salesColumns`, `purchaseColumns` from `lib/csv`; `monthLabel` + `groupByMonth` (already imported in the registers); `window.api.exportCsv`.

- [ ] **Step 1: Add FY + per-month export to `Sales.tsx`**

In `src/renderer/screens/Sales.tsx`:

a) Add imports:

```ts
import { toCsv, salesColumns } from '../lib/csv'
```

b) Inside the component, add a helper (after `remove`):

```ts
  async function exportCsv(rows: Sale[], name: string) {
    if (rows.length === 0) return
    await window.api.exportCsv(name, toCsv(rows, salesColumns))
  }
```

c) Put an "Export FY" button in the page header action, alongside the existing button:

```tsx
      <PageHeader title={`Sales · ${fy}`} action={
        <Group>
          <Button variant="default" disabled={list.length === 0} onClick={() => exportCsv(list, `Sales-FY-${fy}.csv`)}>Export FY</Button>
          <Button onClick={() => nav('/sales/new')}>+ New sale</Button>
        </Group>
      } />
```

d) In the month band header (the `g.key !== 'undated'` branch), add a per-month CSV button. Change the band `Table.Td` content to include the button for month groups:

```tsx
              <Table.Td colSpan={7} bg="var(--mantine-color-gray-1)" fw={700}>
                <Group justify="space-between">
                  <span>{g.key === 'undated' ? 'Reserved' : `${monthLabel(g.key)} — ${g.items.reduce((sum, s) => sum + s.total_qty_kg, 0)} kg · ${formatINR(g.items.reduce((sum, s) => sum + s.total_invoice_amount, 0))}`}</span>
                  {g.key !== 'undated' &&
                    <Button variant="subtle" size="compact-xs" onClick={() => exportCsv(g.items, `Sales-${monthLabel(g.key).replace(' ', '-')}.csv`)}>⭳ CSV</Button>}
                </Group>
              </Table.Td>
```

(`Group` is already imported in `Sales.tsx`.)

- [ ] **Step 2: Add FY + per-month export to `Purchases.tsx`**

In `src/renderer/screens/Purchases.tsx`:

a) Add imports:

```ts
import { toCsv, purchaseColumns } from '../lib/csv'
```

b) Add the helper (after `remove`):

```ts
  async function exportCsv(rows: Purchase[], name: string) {
    if (rows.length === 0) return
    await window.api.exportCsv(name, toCsv(rows, purchaseColumns))
  }
```

c) Page-header action:

```tsx
      <PageHeader title={`Purchases · ${fy}`} action={
        <Group>
          <Button variant="default" disabled={list.length === 0} onClick={() => exportCsv(list, `Purchases-FY-${fy}.csv`)}>Export FY</Button>
          <Button onClick={() => nav('/purchases/new')}>+ Add purchase</Button>
        </Group>
      } />
```

d) Per-month band button (purchases have no undated bucket, so always show it):

```tsx
              <Table.Td colSpan={9} bg="var(--mantine-color-gray-1)" fw={700}>
                <Group justify="space-between">
                  <span>{`${monthLabel(g.key)} — ${g.items.reduce((sum, p) => sum + p.qty_kg, 0)} kg · ${formatINR(g.items.reduce((sum, p) => sum + p.total_invoice_amount, 0))}`}</span>
                  <Button variant="subtle" size="compact-xs" onClick={() => exportCsv(g.items, `Purchases-${monthLabel(g.key).replace(' ', '-')}.csv`)}>⭳ CSV</Button>
                </Group>
              </Table.Td>
```

(`Group` is already imported in `Purchases.tsx`.)

- [ ] **Step 3: Verify typecheck, tests, build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; suite green; build succeeds.

- [ ] **Step 4: Operator pass**

Run: `npm run rebuild:electron && npm run dev`
Expected: On Sales and Purchases, "Export FY" prompts a Save dialog and writes a CSV of the whole FY; each month band's "⭳ CSV" exports just that month; opening the file shows the full GST columns with one row per invoice/purchase; the FY button is disabled when the list is empty.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/screens/Sales.tsx src/renderer/screens/Purchases.tsx
git commit -m "feat: per-month and full-FY CSV export on Sales & Purchases registers"
```

---

## Self-Review

**Spec coverage:**
- Charting lib + renderer-only → A1, A2, A3. ✓
- Payables >2-day rule → A2 `payables` (tested at boundary). ✓
- Receivables created+pending+aging → A2 `receivables`. ✓
- GST net snapshot → A2 `gstSnapshot`. ✓
- Stock by product + value join → A3 `stockByProduct`. ✓
- Inventory aging + value → A3 `inventoryAging` + A5 table. ✓
- Low stock + reserved pending fill → A3 + A4 Action Center. ✓
- Clickable everything (KPIs, action rows, donut, aging table) → A4, A5, A6. ✓
- Monthly trend with ₹/kg toggle → A2 + A5 `TrendChart`. ✓
- KPI ▲▼ deltas → A2 `monthDelta` + A6. ✓
- Empty/error states → widget empty copy + retained error Alert in A6. ✓
- CSV full GST detail, one row per invoice/purchase → B1 columns. ✓
- CSV escaping → B1 `toCsv`. ✓
- `exportCsv` IPC + native dialog + CHANNELS/Api/guard parity → B2. ✓
- Per-month + FY buttons, filenames, empty-disable → B3. ✓
- Testing files (`dashboard.test.ts`, `csv.test.ts`, api-shape stays green) → A2/A3, B1, B2. ✓

**Placeholder scan:** none — every code/test step has full content.

**Type consistency:** `MonthPoint`, `AgingBuckets`, `StockSlice`, `AgeBucket`, `CsvColumn<T>` are defined once and consumed with matching field names across A4–A6 and B1/B3; `exportCsv` signature identical in api.ts and ipc.ts; `salesColumns`/`purchaseColumns` names match between B1 and B3.

**Out of scope (unchanged):** profitability/margins, top customers/suppliers, slow payers, stock cover, cross-FY trends, HSN-level CSV, backend SQL aggregation.
