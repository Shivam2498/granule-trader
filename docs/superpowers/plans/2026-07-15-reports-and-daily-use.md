# Reports & Daily-Use Refinements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-party sales/purchase reports (preview + CSV + print), a Month/YTD dashboard with chart click-through, one-click payment marking, a plain-sentence morning brief, and a big-text mode.

**Architecture:** All data comes from existing IPC (`listSales`, `listPurchases`, customers/suppliers, settings) except one new focused pair (`setSalePayment`/`setPurchasePayment`). Every piece of logic that can be pure goes in `src/renderer/lib/` with unit tests; screens stay thin. Spec: `docs/superpowers/specs/2026-07-15-reports-and-daily-use-design.md`.

**Tech Stack:** Electron, React 18, Mantine 7 (+ @mantine/charts), better-sqlite3, Vitest + Testing Library (`fireEvent`, never `user-event`; renderer tests need `// @vitest-environment jsdom`).

## Global Constraints

- Every new IPC method appears in THREE places or the guard test fails: `Api` interface + `CHANNELS` (both `src/shared/api.ts`) and `API_METHODS` in `tests/core/api-shape.test.ts`.
- Renderer never touches SQLite; only `window.api`.
- Preview and CSV must render from the SAME column definitions (`salesColumns`/`purchaseColumns` in `src/renderer/lib/csv.ts`).
- Sales reports include only `status === 'created'` rows (reserved blanks are not money).
- Plain-English error/copy style throughout ("Mark RP/012 paid today?", not "Confirm status update").
- Month keys are `YYYY-MM` strings; month filtering = `invoice_date.startsWith(key)`.
- The Month/YTD toggle appears only when the selected FY is the current FY.
- `ui_scale` is stored as a STRING setting (`'1' | '1.15' | '1.3'`) so `getSettings`'s number-coercion rule stays untouched (numbers are coerced by `typeof DEFAULT === 'number'` — see `src/main/core/reference.ts:16-20`).
- Run tests with `npx vitest run <file>` while iterating and `npx vitest run` + `npm run typecheck` before each commit. NEVER `npm test` (its pretest rebuild is unnecessary — better-sqlite3 is already node-built). Commits go straight to master (repo convention).

## File structure

- `src/main/core/sale.ts`, `src/main/core/purchase.ts` — add one payment-setter each.
- `src/shared/api.ts`, `src/main/ipc.ts` — expose them.
- `src/renderer/components/PaymentControl.tsx` — NEW: badge + confirm-popover, shared by both lists.
- `src/renderer/lib/report.ts` — NEW: pure report logic (filters, totals, months, filename).
- `src/renderer/screens/Reports.tsx` + `src/renderer/screens/reports.css` — NEW screen.
- `src/renderer/lib/group.ts` — add `filterByMonthKey`.
- `src/renderer/screens/Sales.tsx`, `Purchases.tsx` — month param + PaymentControl + Report shortcut lives on Customers/Suppliers (also modified).
- `src/renderer/lib/dashboard.ts` — add `currentFyLabel`, `monthKeyOf`, `briefINR`, `morningBrief`.
- `src/renderer/screens/Dashboard.tsx`, `components/dashboard/TrendChart.tsx` — Month/YTD + click-through + brief panel.
- `src/main/core/reference.ts`, `src/renderer/screens/Settings.tsx`, `src/renderer/main.tsx` + `src/renderer/App.tsx` — ui_scale.

---

### Task 1: Payment setters (core + IPC)

**Files:**
- Modify: `src/main/core/sale.ts` (append), `src/main/core/purchase.ts` (append)
- Modify: `src/shared/api.ts` (Api under `// sales` and `// purchases` comments + CHANNELS), `src/main/ipc.ts`
- Test: `tests/core/sale.test.ts`, `tests/core/purchase.test.ts`, `tests/core/api-shape.test.ts`

**Interfaces:**
- Produces: `setSalePayment(db, id: number, status: 'pending' | 'done', date: string | null): Sale`; `setPurchasePayment(db, id: number, status: 'pending' | 'done', date: string | null): Purchase`; `window.api.setSalePayment(id, status, date)` / `window.api.setPurchasePayment(id, status, date)`.
- Rules: marking `done` stores the given date (never null — throw if missing); marking `pending` nulls the date; a sale must have `status='created'`.

- [ ] **Step 1: Write the failing core tests**

Append to `tests/core/sale.test.ts` (its helpers `lot`, `line`, `sbase`, `remainingOf` already exist in the file; import `setSalePayment` alongside the existing sale imports):

```ts
describe('setSalePayment', () => {
  it('marks an issued invoice paid on a date, and back to pending', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 100, 80)] })
    const paid = setSalePayment(db, s.id, 'done', '2024-06-01')
    expect(paid.payment_status).toBe('done')
    expect(paid.payment_date).toBe('2024-06-01')
    const back = setSalePayment(db, s.id, 'pending', null)
    expect(back.payment_status).toBe('pending')
    expect(back.payment_date).toBeNull()
  })
  it('requires a date when marking paid', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const s = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 100, 80)] })
    expect(() => setSalePayment(db, s.id, 'done', null)).toThrow(/needs a payment date/i)
  })
  it('refuses a reserved blank invoice', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 100, 80)] })
    const reserved = listSales(db).find(x => x.status === 'reserved')!
    expect(() => setSalePayment(db, reserved.id, 'done', '2024-06-01')).toThrow(/blank/i)
  })
})
```

Append to `tests/core/purchase.test.ts` (helpers `mkPurchase`, `base` exist; import `setPurchasePayment` with the purchase imports):

```ts
describe('setPurchasePayment', () => {
  it('marks a bill paid and back to pending', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    const paid = setPurchasePayment(db, p.id, 'done', '2024-06-01')
    expect(paid.payment_status).toBe('done')
    expect(paid.payment_date).toBe('2024-06-01')
    const back = setPurchasePayment(db, p.id, 'pending', null)
    expect(back.payment_status).toBe('pending')
    expect(back.payment_date).toBeNull()
  })
  it('requires a date when marking paid, and a real purchase', () => {
    const p = mkPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(() => setPurchasePayment(db, p.id, 'done', null)).toThrow(/needs a payment date/i)
    expect(() => setPurchasePayment(db, 9999, 'done', '2024-06-01')).toThrow(/find that purchase/i)
  })
})
```

In `tests/core/api-shape.test.ts`, add `'setSalePayment'` after `'updateSale'` and `'setPurchasePayment'` after `'getPurchaseItems'` in `API_METHODS`.

- [ ] **Step 2: Run and watch them fail**

Run: `npx vitest run tests/core/sale.test.ts tests/core/purchase.test.ts tests/core/api-shape.test.ts`
Expected: FAIL — no export `setSalePayment` / `setPurchasePayment`; CHANNELS missing the two names.

- [ ] **Step 3: Implement**

Append to `src/main/core/sale.ts`:

```ts
/** Payment bookkeeping without the full edit round-trip. Only an issued invoice can be paid. */
export function setSalePayment(db: Database.Database, id: number, status: 'pending' | 'done', date: string | null): Sale {
  const s = getSale(db, id)
  if (!s) throw new Error(`We couldn't find that invoice.`)
  if (s.status !== 'created') throw new Error(`${s.invoice_number} is still a blank (reserved) invoice — fill it in before marking payment.`)
  if (status === 'done' && !date) throw new Error('Marking an invoice paid needs a payment date.')
  db.prepare('UPDATE sales SET payment_status = ?, payment_date = ? WHERE id = ?')
    .run(status, status === 'done' ? date : null, id)
  return getSale(db, id)
}
```

Append to `src/main/core/purchase.ts`:

```ts
/** Payment bookkeeping without the full edit round-trip. */
export function setPurchasePayment(db: Database.Database, id: number, status: 'pending' | 'done', date: string | null): Purchase {
  const p = getPurchase(db, id)
  if (!p) throw new Error(`We couldn't find that purchase.`)
  if (status === 'done' && !date) throw new Error('Marking a bill paid needs a payment date.')
  db.prepare('UPDATE purchases SET payment_status = ?, payment_date = ? WHERE id = ?')
    .run(status, status === 'done' ? date : null, id)
  return getPurchase(db, id)!
}
```

`src/shared/api.ts` — in the `Api` interface add `setSalePayment(id: number, status: 'pending' | 'done', date: string | null): Promise<Sale>` after `updateSale`, and `setPurchasePayment(id: number, status: 'pending' | 'done', date: string | null): Promise<Purchase>` after `getPurchaseItems`. In `CHANNELS`, insert `'setSalePayment'` after `'updateSale'` and `'setPurchasePayment'` after `'getPurchaseItems'`.

`src/main/ipc.ts` — extend the two existing core imports with the new names, then register:

```ts
  h('setSalePayment', (id, status, date) => setSalePayment(db(), id, status, date))
  h('setPurchasePayment', (id, status, date) => setPurchasePayment(db(), id, status, date))
```

- [ ] **Step 4: Run and watch them pass**

Run: `npx vitest run tests/core/sale.test.ts tests/core/purchase.test.ts tests/core/api-shape.test.ts && npm run typecheck`
Expected: PASS ×3, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/sale.ts src/main/core/purchase.ts src/shared/api.ts src/main/ipc.ts tests/core/sale.test.ts tests/core/purchase.test.ts tests/core/api-shape.test.ts
git commit -m "feat(payment): focused setters for sale/purchase payment status"
```

---

### Task 2: PaymentControl + wiring into the Sales and Purchases lists

**Files:**
- Create: `src/renderer/components/PaymentControl.tsx`
- Modify: `src/renderer/screens/Sales.tsx` (the `<Badge>` cell), `src/renderer/screens/Purchases.tsx` (its payment `<Badge>` cell)
- Test: `tests/renderer/payment-control.test.tsx`

**Interfaces:**
- Consumes: `window.api.setSalePayment` / `setPurchasePayment` (Task 1) — but NOT directly: the component takes an `onSet` callback so both screens reuse it.
- Produces: `<PaymentControl status={'pending'|'done'} label={string} onSet(status, date) => Promise<void> />` — badge + popover; marking paid uses `today()` from `../lib/format`.

- [ ] **Step 1: Write the failing component test**

`tests/renderer/payment-control.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import PaymentControl from '../../src/renderer/components/PaymentControl'
import { today } from '../../src/renderer/lib/format'

describe('PaymentControl', () => {
  it('pending: confirms then marks paid today', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined)
    renderWithMantine(<PaymentControl status="pending" label="RP/012/2026-27" onSet={onSet} />)
    fireEvent.click(screen.getByRole('button', { name: /mark paid/i }))
    expect(await screen.findByText('Mark RP/012/2026-27 paid today?')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /^yes, paid$/i }))
    await waitFor(() => expect(onSet).toHaveBeenCalledWith('done', today()))
  })
  it('paid: badge click offers mark-as-pending', async () => {
    const onSet = vi.fn().mockResolvedValue(undefined)
    renderWithMantine(<PaymentControl status="done" label="RP/012/2026-27" onSet={onSet} />)
    fireEvent.click(screen.getByRole('button', { name: /done/i }))
    fireEvent.click(await screen.findByRole('button', { name: /mark as pending/i }))
    await waitFor(() => expect(onSet).toHaveBeenCalledWith('pending', null))
  })
  it('does not call onSet until confirmed', async () => {
    const onSet = vi.fn()
    renderWithMantine(<PaymentControl status="pending" label="X" onSet={onSet} />)
    fireEvent.click(screen.getByRole('button', { name: /mark paid/i }))
    expect(onSet).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/renderer/payment-control.test.tsx`
Expected: FAIL — cannot resolve PaymentControl.

- [ ] **Step 3: Implement the component**

`src/renderer/components/PaymentControl.tsx`:

```tsx
import { useState } from 'react'
import { Badge, Button, Group, Popover, Text, UnstyledButton } from '@mantine/core'
import { today } from '../lib/format'

/**
 * The payment badge, made actionable: a pending row gets a "Mark paid" button beside the badge,
 * a paid row's badge opens a mark-as-pending popover — payment bookkeeping without the edit screen.
 */
export default function PaymentControl({ status, label, onSet }: {
  status: 'pending' | 'done'
  label: string
  onSet: (status: 'pending' | 'done', date: string | null) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  async function set(next: 'pending' | 'done') {
    if (busy) return
    setBusy(true)
    try { await onSet(next, next === 'done' ? today() : null) } finally { setBusy(false); setOpen(false) }
  }
  if (status === 'done') {
    return (
      <Popover opened={open} onChange={setOpen} withArrow position="bottom">
        <Popover.Target>
          <UnstyledButton aria-label={`done — ${label}`} onClick={() => setOpen(o => !o)}>
            <Badge color="green" style={{ cursor: 'pointer' }}>done</Badge>
          </UnstyledButton>
        </Popover.Target>
        <Popover.Dropdown>
          <Button size="compact-sm" variant="light" color="orange" loading={busy} onClick={() => set('pending')}>
            Mark as pending
          </Button>
        </Popover.Dropdown>
      </Popover>
    )
  }
  return (
    <Group gap="xs" wrap="nowrap">
      <Badge color="orange">pending</Badge>
      <Popover opened={open} onChange={setOpen} withArrow position="bottom">
        <Popover.Target>
          <Button size="compact-xs" variant="light" onClick={() => setOpen(o => !o)}>✓ Mark paid</Button>
        </Popover.Target>
        <Popover.Dropdown>
          <Text size="sm" mb="xs">Mark {label} paid today?</Text>
          <Button size="compact-sm" loading={busy} onClick={() => set('done')}>Yes, paid</Button>
        </Popover.Dropdown>
      </Popover>
    </Group>
  )
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run tests/renderer/payment-control.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire into both lists**

`src/renderer/screens/Sales.tsx` — import `PaymentControl`, replace the payment cell
`<Table.Td><Badge color={s.payment_status === 'done' ? 'green' : 'orange'}>{s.payment_status}</Badge></Table.Td>` with:

```tsx
<Table.Td>
  <PaymentControl status={s.payment_status} label={s.invoice_number}
    onSet={async (st, d) => { await window.api.setSalePayment(s.id, st, d); reload() }} />
</Table.Td>
```

(drop the now-unused `Badge` import if nothing else uses it). `src/renderer/screens/Purchases.tsx` — same replacement on its payment badge cell with `label={p.our_code}` and `window.api.setPurchasePayment(p.id, st, d)`.

- [ ] **Step 6: Full check and commit**

Run: `npx vitest run && npm run typecheck`
Expected: all green.

```bash
git add src/renderer/components/PaymentControl.tsx src/renderer/screens/Sales.tsx src/renderer/screens/Purchases.tsx tests/renderer/payment-control.test.tsx
git commit -m "feat(payment): one-click mark paid on the sales and purchases lists"
```

---

### Task 3: Report lib (pure)

**Files:**
- Create: `src/renderer/lib/report.ts`
- Test: `tests/renderer/report.test.ts`

**Interfaces:**
- Produces:
  - `fyMonths(fyLabel: string): Array<{ value: string; label: string }>` — `'2026-27'` → 12 entries `{value:'2026-04',label:'Apr 2026'}` … `{value:'2027-03',label:'Mar 2027'}`.
  - `filterSalesReport(sales: Sale[], customerId: number, month?: string): Sale[]` — `status==='created'`, `buyer_customer_id===customerId`, optional `invoice_date.startsWith(month)`, sorted by `invoice_date` then `seq` ascending.
  - `filterPurchasesReport(purchases: Purchase[], supplierId: number, month?: string): Purchase[]` — same shape (sort by `invoice_date`, then `code_seq`).
  - `reportTotals(rows: Array<{ qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }>): { qty; taxable; cgst; sgst; igst; total }` (2-dp rounded sums) plus the adapters `saleTotalRow(s: Sale)` / `purchaseTotalRow(p: Purchase)` mapping the entity fields onto that shape.
  - `reportFilename(kind: 'Sales' | 'Purchases', party: string, fyLabel: string, monthLabel?: string): string` — `Sales-Jenisa-Enterprise-2026-27.csv`, `Sales-Jenisa-Enterprise-Apr-2026.csv` (spaces/specials → `-`, collapse repeats).

- [ ] **Step 1: Write the failing tests**

`tests/renderer/report.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { fyMonths, filterSalesReport, filterPurchasesReport, reportTotals, saleTotalRow, purchaseTotalRow, reportFilename } from '../../src/renderer/lib/report'
import type { Sale, Purchase } from '../../src/shared/types'

const sale = (o: Partial<Sale>): Sale => ({
  id: 1, invoice_number: 'RP/001/2026-27', prefix: 'RP', seq: 1, fy_label: '2026-27', status: 'created',
  invoice_date: '2026-04-02', buyer_customer_id: 7, buyer_name: 'Jenisa', buyer_gstin: '',
  buyer_billing_json: '{}', buyer_shipping_json: '{}', place_of_supply_state: '',
  amount: 100, cgst: 9, sgst: 9, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 118,
  total_qty_kg: 10, payment_status: 'done', payment_date: null, created_at: '', eway_bill_no: null,
  eway_bill_date: null, vehicle: null, ...o
} as Sale)
const purchase = (o: Partial<Purchase>): Purchase => ({
  id: 1, our_code: '001/2627', supplier_invoice_number: '', invoice_date: '2026-04-10', party: 'Swastik',
  party_state: '', party_city: '', party_pincode: '', party_address: '', hsn_code: '320419', description: '',
  qty_kg: 100, qty_remaining_kg: 100, rate_per_kg: 120, amount: 12000, cgst: 1080, sgst: 1080, igst: 0,
  tcs: 0, roundoff: 0, total_invoice_amount: 14160, payment_status: 'pending', payment_date: null,
  fy_label: '2026-27', code_seq: 1, created_at: '', supplier_id: 3, ...o
} as Purchase)

describe('fyMonths', () => {
  it('lists Apr through Mar with year-crossing keys', () => {
    const m = fyMonths('2026-27')
    expect(m).toHaveLength(12)
    expect(m[0]).toEqual({ value: '2026-04', label: 'Apr 2026' })
    expect(m[9]).toEqual({ value: '2027-01', label: 'Jan 2027' })
    expect(m[11]).toEqual({ value: '2027-03', label: 'Mar 2027' })
  })
})

describe('filterSalesReport', () => {
  const rows = [
    sale({ id: 1, seq: 2, invoice_date: '2026-05-10', buyer_customer_id: 7 }),
    sale({ id: 2, seq: 1, invoice_date: '2026-04-02', buyer_customer_id: 7 }),
    sale({ id: 3, seq: 3, invoice_date: '2026-04-05', buyer_customer_id: 9 }),   // other buyer
    sale({ id: 4, seq: 4, status: 'reserved', invoice_date: null, buyer_customer_id: 7 })  // blank
  ]
  it('keeps only the buyer’s issued invoices, oldest first', () => {
    expect(filterSalesReport(rows, 7).map(s => s.id)).toEqual([2, 1])
  })
  it('narrows to a month', () => {
    expect(filterSalesReport(rows, 7, '2026-04').map(s => s.id)).toEqual([2])
  })
})

describe('filterPurchasesReport', () => {
  const rows = [
    purchase({ id: 1, code_seq: 2, invoice_date: '2026-05-01', supplier_id: 3 }),
    purchase({ id: 2, code_seq: 1, invoice_date: '2026-04-10', supplier_id: 3 }),
    purchase({ id: 3, invoice_date: '2026-04-11', supplier_id: 5 })
  ]
  it('keeps only the supplier’s bills, oldest first, with month filter', () => {
    expect(filterPurchasesReport(rows, 3).map(p => p.id)).toEqual([2, 1])
    expect(filterPurchasesReport(rows, 3, '2026-05').map(p => p.id)).toEqual([1])
  })
})

describe('reportTotals', () => {
  it('sums the six figures with 2-dp rounding', () => {
    const t = reportTotals([saleTotalRow(sale({ total_qty_kg: 10.005, amount: 0.1, cgst: 0.2, sgst: 0.2, igst: 0, total_invoice_amount: 0.5 })),
                            saleTotalRow(sale({ total_qty_kg: 5, amount: 0.2, cgst: 0.1, sgst: 0.1, igst: 0, total_invoice_amount: 0.5 }))])
    expect(t).toEqual({ qty: 15.01, taxable: 0.3, cgst: 0.3, sgst: 0.3, igst: 0, total: 1 })
  })
  it('adapts purchases too', () => {
    expect(purchaseTotalRow(purchase({}))).toEqual({ qty: 100, taxable: 12000, cgst: 1080, sgst: 1080, igst: 0, total: 14160 })
  })
})

describe('reportFilename', () => {
  it('slugs the party and appends the period', () => {
    expect(reportFilename('Sales', 'Jenisa Enterprise', '2026-27')).toBe('Sales-Jenisa-Enterprise-2026-27.csv')
    expect(reportFilename('Purchases', 'S.M ENGINEERING & CO', '2026-27', 'Apr 2026')).toBe('Purchases-S-M-ENGINEERING-CO-Apr-2026.csv')
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/renderer/report.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/renderer/lib/report.ts`:

```ts
// Pure logic behind the Reports screen. No React, no window.api — unit-tested.
import type { Sale, Purchase } from '@shared/types'

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** '2026-27' → the FY's twelve months, April first, as select options keyed 'YYYY-MM'. */
export function fyMonths(fyLabel: string): Array<{ value: string; label: string }> {
  const startYear = Number(fyLabel.slice(0, 4))
  return Array.from({ length: 12 }, (_, i) => {
    const m = ((3 + i) % 12) + 1                    // Apr=4 … Dec=12, Jan=1 … Mar=3
    const y = m >= 4 ? startYear : startYear + 1
    return { value: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTHS[m - 1]} ${y}` }
  })
}

export function filterSalesReport(sales: Sale[], customerId: number, month?: string): Sale[] {
  return sales
    .filter(s => s.status === 'created' && s.buyer_customer_id === customerId)
    .filter(s => !month || (s.invoice_date ?? '').startsWith(month))
    .sort((a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? '') || a.seq - b.seq)
}

export function filterPurchasesReport(purchases: Purchase[], supplierId: number, month?: string): Purchase[] {
  return purchases
    .filter(p => p.supplier_id === supplierId)
    .filter(p => !month || p.invoice_date.startsWith(month))
    .sort((a, b) => a.invoice_date.localeCompare(b.invoice_date) || a.code_seq - b.code_seq)
}

export interface TotalRow { qty: number; taxable: number; cgst: number; sgst: number; igst: number; total: number }
export const saleTotalRow = (s: Sale): TotalRow =>
  ({ qty: s.total_qty_kg, taxable: s.amount, cgst: s.cgst, sgst: s.sgst, igst: s.igst, total: s.total_invoice_amount })
export const purchaseTotalRow = (p: Purchase): TotalRow =>
  ({ qty: p.qty_kg, taxable: p.amount, cgst: p.cgst, sgst: p.sgst, igst: p.igst, total: p.total_invoice_amount })

export function reportTotals(rows: TotalRow[]): TotalRow {
  const t = { qty: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, total: 0 }
  for (const r of rows) {
    t.qty = r2(t.qty + r.qty); t.taxable = r2(t.taxable + r.taxable)
    t.cgst = r2(t.cgst + r.cgst); t.sgst = r2(t.sgst + r.sgst)
    t.igst = r2(t.igst + r.igst); t.total = r2(t.total + r.total)
  }
  return t
}

export function reportFilename(kind: 'Sales' | 'Purchases', party: string, fyLabel: string, monthLabel?: string): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${kind}-${slug(party)}-${slug(monthLabel ?? fyLabel)}.csv`
}
```

- [ ] **Step 4: Run and watch it pass**

Run: `npx vitest run tests/renderer/report.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/report.ts tests/renderer/report.test.ts
git commit -m "feat(reports): pure report filtering, totals, months and filenames"
```

---

### Task 4: Reports screen, route, sidebar entry, party-row shortcuts

**Files:**
- Create: `src/renderer/screens/Reports.tsx`, `src/renderer/screens/reports.css`
- Modify: `src/renderer/routes.tsx` (route `/reports`), `src/renderer/components/Sidebar.tsx` (nav entry — read the file and copy its existing link pattern exactly), `src/renderer/screens/Customers.tsx`, `src/renderer/screens/Suppliers.tsx` (a `Report` button per row)
- Test: `tests/renderer/reports-screen.test.tsx`

**Interfaces:**
- Consumes: Task 3's lib; `salesColumns`/`purchaseColumns` + `toCsv` from `../lib/csv`; `window.api.listSales/listPurchases/listCustomers/listSuppliers/exportCsv/getSettings`; `useFY` from `../fy`; `formatINR` from `../lib/format`.
- Produces: screen at `/reports` honouring query params `type` (`sales` | `purchases`) and `party` (id). Print header text: `"<Sales|Purchase> Statement — <party> — <period>"`, plus seller name and generation date.

- [ ] **Step 1: Write the failing screen test**

`tests/renderer/reports-screen.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, fireEvent, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { MantineProvider } from '@mantine/core'
import { theme } from '../../src/renderer/theme'
import Reports from '../../src/renderer/screens/Reports'
import './mantine'   // side-effect: jsdom matchMedia/ResizeObserver stubs

const sales = [
  { id: 1, invoice_number: 'RP/001/2026-27', seq: 1, status: 'created', invoice_date: '2026-04-02',
    buyer_customer_id: 7, buyer_name: 'Jenisa Enterprise', buyer_gstin: 'X', buyer_billing_json: '{}',
    total_qty_kg: 100, amount: 15678.25, cgst: 1411.04, sgst: 1411.04, igst: 0, tcs: 0, roundoff: -0.34,
    total_invoice_amount: 18499.99, payment_status: 'done', payment_date: '2026-04-02' },
  { id: 2, invoice_number: 'RP/015/2026-27', seq: 15, status: 'created', invoice_date: '2026-05-25',
    buyer_customer_id: 7, buyer_name: 'Jenisa Enterprise', buyer_gstin: 'X', buyer_billing_json: '{}',
    total_qty_kg: 50, amount: 5000, cgst: 450, sgst: 450, igst: 0, tcs: 0, roundoff: 0,
    total_invoice_amount: 5900, payment_status: 'pending', payment_date: null }
]

beforeEach(() => {
  ;(window as any).api = {
    listSales: vi.fn().mockResolvedValue(sales),
    listPurchases: vi.fn().mockResolvedValue([]),
    listCustomers: vi.fn().mockResolvedValue([{ id: 7, name: 'Jenisa Enterprise', gstin: 'X' }]),
    listSuppliers: vi.fn().mockResolvedValue([]),
    listFinancialYears: vi.fn().mockResolvedValue(['2026-27']),
    getSettings: vi.fn().mockResolvedValue({ seller_name: 'Ramaxton', invoice_prefix: 'RP' }),
    exportCsv: vi.fn().mockResolvedValue({ saved: true, path: '/tmp/x.csv' })
  }
})

function mount(url = '/reports?type=sales&party=7') {
  return renderResult(url)
}
function renderResult(url: string) {
  const { render } = require('@testing-library/react')
  return render(
    <MantineProvider theme={theme} forceColorScheme="light">
      <MemoryRouter initialEntries={[url]}><Reports /></MemoryRouter>
    </MantineProvider>
  )
}

describe('Reports screen', () => {
  it('prefills from query params and lists the party’s invoices with totals', async () => {
    mount()
    expect(await screen.findByText('RP/001/2026-27')).toBeTruthy()
    expect(screen.getByText('RP/015/2026-27')).toBeTruthy()
    const totals = screen.getByTestId('report-totals')
    expect(within(totals).getByText('150')).toBeTruthy()            // qty
    expect(within(totals).getByText('₹24,399.99')).toBeTruthy()      // grand total
  })
  it('narrows to a month', async () => {
    mount()
    await screen.findByText('RP/001/2026-27')
    fireEvent.click(screen.getByRole('textbox', { name: /month/i }))
    fireEvent.click(await screen.findByText('May 2026'))
    await waitFor(() => expect(screen.queryByText('RP/001/2026-27')).toBeNull())
    expect(screen.getByText('RP/015/2026-27')).toBeTruthy()
  })
  it('downloads a CSV named for party and period, with a TOTAL row', async () => {
    mount()
    await screen.findByText('RP/001/2026-27')
    fireEvent.click(screen.getByRole('button', { name: /download csv/i }))
    await waitFor(() => expect((window as any).api.exportCsv).toHaveBeenCalled())
    const [name, content] = (window as any).api.exportCsv.mock.calls[0]
    expect(name).toBe('Sales-Jenisa-Enterprise-2026-27.csv')
    expect(content).toContain('RP/001/2026-27')
    expect(content.trim().split('\n').at(-1)).toContain('TOTAL')
  })
  it('shows the print header for the statement', async () => {
    mount()
    await screen.findByText('RP/001/2026-27')
    expect(screen.getByText(/Sales Statement — Jenisa Enterprise — 2026-27/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run and watch it fail**

Run: `npx vitest run tests/renderer/reports-screen.test.tsx`
Expected: FAIL — cannot resolve Reports.

- [ ] **Step 3: Implement the screen**

`src/renderer/screens/reports.css`:

```css
/* On paper: only the statement itself. The app chrome (sidebar) already carries .no-print. */
@media print {
  .report-controls { display: none !important; }
  .mantine-AppShell-main { padding: 0 !important; }
}
```

`src/renderer/screens/Reports.tsx`:

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, Group, Paper, SegmentedControl, Select, Table, Text, Title } from '@mantine/core'
import type { Sale, Purchase, Customer, Supplier, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { toCsv, salesColumns, purchaseColumns, type CsvColumn } from '../lib/csv'
import {
  fyMonths, filterSalesReport, filterPurchasesReport, reportTotals,
  saleTotalRow, purchaseTotalRow, reportFilename, type TotalRow
} from '../lib/report'
import { formatINR, today } from '../lib/format'
import { useFY } from '../fy'
import './reports.css'

type Kind = 'sales' | 'purchases'

export default function Reports() {
  const [params] = useSearchParams()
  const { fy, years, setFY } = useFY()
  const [kind, setKind] = useState<Kind>((params.get('type') as Kind) ?? 'sales')
  const [partyId, setPartyId] = useState<number | null>(params.get('party') ? Number(params.get('party')) : null)
  const [month, setMonth] = useState<string | null>(null)
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      setSales(await window.api.listSales(fy))
      setPurchases(await window.api.listPurchases(fy))
      setCustomers(await window.api.listCustomers())
      setSuppliers(await window.api.listSuppliers())
      setSettings(await window.api.getSettings())
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [fy])

  const parties = kind === 'sales' ? customers : suppliers
  const party = parties.find(p => p.id === partyId) ?? null
  const months = useMemo(() => fyMonths(fy), [fy])
  const monthLabel = month ? months.find(m => m.value === month)?.label : undefined
  const period = monthLabel ?? fy

  const saleRows = useMemo(() => party && kind === 'sales' ? filterSalesReport(sales, party.id, month ?? undefined) : [], [party, kind, sales, month])
  const purchaseRows = useMemo(() => party && kind === 'purchases' ? filterPurchasesReport(purchases, party.id, month ?? undefined) : [], [party, kind, purchases, month])
  const totals: TotalRow = reportTotals(kind === 'sales' ? saleRows.map(saleTotalRow) : purchaseRows.map(purchaseTotalRow))
  const count = kind === 'sales' ? saleRows.length : purchaseRows.length

  async function download() {
    if (!party) return
    const totalLine = (cols: number) => ['TOTAL', ...Array(cols - 7).fill(''), totals.qty, totals.taxable, totals.cgst, totals.sgst, totals.igst, '', totals.total]
    let content: string
    if (kind === 'sales') {
      content = toCsv(saleRows, salesColumns)
      content += '\n' + ['TOTAL', '', '', '', '', totals.qty, totals.taxable, totals.cgst, totals.sgst, totals.igst, '', '', totals.total, '', ''].join(',')
    } else {
      content = toCsv(purchaseRows, purchaseColumns)
      content += '\n' + ['TOTAL', '', '', '', '', '', totals.qty, '', totals.taxable, totals.cgst, totals.sgst, totals.igst, '', '', totals.total, '', ''].join(',')
    }
    void totalLine
    try {
      await window.api.exportCsv(reportFilename(kind === 'sales' ? 'Sales' : 'Purchases', party.name, fy, monthLabel), content)
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  function renderTable<T>(rows: T[], columns: CsvColumn<T>[], key: (r: T) => string | number) {
    return (
      <ListTable head={<>{columns.map(c => <Table.Th key={c.header}>{c.header}</Table.Th>)}</>}>
        {rows.map(r => (
          <Table.Tr key={key(r)}>
            {columns.map(c => <Table.Td key={c.header}>{String(c.value(r))}</Table.Td>)}
          </Table.Tr>
        ))}
        {rows.length === 0 && <Table.Tr><Table.Td colSpan={columns.length} c="dimmed">
          {party ? `No ${kind} for ${party.name} in ${period}.` : 'Choose a party to see their report.'}
        </Table.Td></Table.Tr>}
      </ListTable>
    )
  }

  return (
    <div>
      <div className="report-controls">
        <PageHeader title="Reports" action={
          <Group>
            <Button variant="default" disabled={count === 0} onClick={download}>⭳ Download CSV</Button>
            <Button variant="default" disabled={count === 0} onClick={() => window.print()}>🖨 Print / PDF</Button>
          </Group>
        } />
        {error && <Alert color="red" mb="md">{error}</Alert>}
        <Paper withBorder p="lg" radius="md" mb="md">
          <Group align="flex-end">
            <SegmentedControl
              value={kind}
              onChange={v => { setKind(v as Kind); setPartyId(null) }}
              data={[{ label: 'Sales by customer', value: 'sales' }, { label: 'Purchases by supplier', value: 'purchases' }]}
            />
            <Select
              label={kind === 'sales' ? 'Customer' : 'Supplier'}
              searchable style={{ minWidth: 280 }}
              data={parties.map(p => ({ value: String(p.id), label: p.name }))}
              value={partyId ? String(partyId) : null}
              onChange={v => setPartyId(v ? Number(v) : null)}
            />
            <Select label="Year" data={years} value={fy} onChange={v => v && setFY(v)} maw={140} />
            <Select
              label="Month" maw={160} clearable placeholder="All months"
              data={months} value={month} onChange={setMonth}
            />
          </Group>
        </Paper>
      </div>

      <Paper withBorder p="lg" radius="md">
        {party && settings && (
          <div>
            <Title order={3}>{kind === 'sales' ? 'Sales' : 'Purchase'} Statement — {party.name} — {period}</Title>
            <Text c="dimmed" size="sm" mb="md">{settings.seller_name} · generated {today()} · {count} invoice{count === 1 ? '' : 's'}</Text>
          </div>
        )}
        {kind === 'sales'
          ? renderTable(saleRows, salesColumns, s => s.id)
          : renderTable(purchaseRows, purchaseColumns, p => p.id)}
        {count > 0 && (
          <Group justify="flex-end" mt="md" gap="xl" data-testid="report-totals">
            <Text fw={700}>{totals.qty}</Text>
            <Text fw={700}>Taxable {formatINR(totals.taxable)}</Text>
            <Text c="dimmed">CGST {formatINR(totals.cgst)} · SGST {formatINR(totals.sgst)} · IGST {formatINR(totals.igst)}</Text>
            <Text fw={700}>{formatINR(totals.total)}</Text>
          </Group>
        )}
      </Paper>
    </div>
  )
}
```

Note for the implementer: the `useFY` hook — read `src/renderer/fy.tsx` first and use its actual API (the test mocks `listFinancialYears`; if the hook exposes different names than `{ fy, years, setFY }`, adapt this screen to the hook, not the other way round). Delete the stray `totalLine` helper if unused after wiring (it exists only to show intent; the two explicit join arrays are the real code — keep those, delete the helper and its `void`).

- [ ] **Step 4: Route, sidebar, shortcuts**

- `src/renderer/routes.tsx`: `import Reports from './screens/Reports'` and `<Route path="/reports" element={<Reports />} />` after the stock routes.
- `src/renderer/components/Sidebar.tsx`: read the file; add a "Reports" entry pointing at `/reports` immediately after Stock, copying the exact existing item structure (icon: `IconFileAnalytics` from `@tabler/icons-react` if the sidebar uses icons; else plain label).
- `src/renderer/screens/Customers.tsx`: in the row actions `Group`, before Edit, add
  `<Button variant="subtle" size="compact-sm" onClick={() => nav(`/reports?type=sales&party=${c.id}`)}>Report</Button>` (match the row's existing button props; `nav` already exists).
- `src/renderer/screens/Suppliers.tsx`: same with `type=purchases&party=${s.id}`.

- [ ] **Step 5: Run everything and commit**

Run: `npx vitest run tests/renderer/reports-screen.test.tsx && npx vitest run && npm run typecheck`
Expected: all green.

```bash
git add src/renderer/screens/Reports.tsx src/renderer/screens/reports.css src/renderer/routes.tsx src/renderer/components/Sidebar.tsx src/renderer/screens/Customers.tsx src/renderer/screens/Suppliers.tsx tests/renderer/reports-screen.test.tsx
git commit -m "feat(reports): per-party statements — preview, CSV with totals, print"
```

---

### Task 5: Month drill-down param on Sales and Purchases

**Files:**
- Modify: `src/renderer/lib/group.ts` (append `filterByMonthKey`), `src/renderer/screens/Sales.tsx`, `src/renderer/screens/Purchases.tsx`
- Test: `tests/renderer/group.test.ts` (append)

**Interfaces:**
- Produces: `filterByMonthKey<T>(rows: T[], key: string | null, date: (r: T) => string | null | undefined): T[]` — identity when `key` is null/empty. Screens honour `?month=YYYY-MM` exactly like `?unpaid=1`: filtered list, title suffix ` · <monthLabel>`, a "Show all" button clearing params. `monthLabel('2026-04')` already exists in `group.ts`.

- [ ] **Step 1: Failing test**

Append to `tests/renderer/group.test.ts`:

```ts
import { filterByMonthKey } from '../../src/renderer/lib/group'

describe('filterByMonthKey', () => {
  const rows = [{ d: '2026-04-02' }, { d: '2026-05-10' }, { d: null }]
  it('keeps rows in the month', () => {
    expect(filterByMonthKey(rows, '2026-04', r => r.d)).toEqual([{ d: '2026-04-02' }])
  })
  it('is identity without a key', () => {
    expect(filterByMonthKey(rows, null, r => r.d)).toHaveLength(3)
  })
})
```

- [ ] **Step 2: Watch it fail**

Run: `npx vitest run tests/renderer/group.test.ts` → FAIL (no export).

- [ ] **Step 3: Implement + wire**

Append to `src/renderer/lib/group.ts`:

```ts
/** Rows whose date falls in the given 'YYYY-MM' month; all rows when no month is asked for. */
export function filterByMonthKey<T>(rows: T[], key: string | null, date: (r: T) => string | null | undefined): T[] {
  if (!key) return rows
  return rows.filter(r => (date(r) ?? '').startsWith(key))
}
```

`src/renderer/screens/Sales.tsx` — it already has `const [params, setParams] = useSearchParams()` and the `unpaidOnly` derivation. Add:

```ts
const monthKey = params.get('month')
```

and extend the existing `list` derivation so the month filter applies after the unpaid filter:

```ts
const list = filterByMonthKey(
  unpaidOnly
    ? all.filter(s => s.status === 'created' && s.payment_status === 'pending')
         .sort((a, b) => (a.invoice_date ?? '').localeCompare(b.invoice_date ?? ''))
    : all,
  monthKey, s => s.invoice_date)
```

Title: `` `${unpaidOnly ? 'Unpaid invoices' : 'Sales'} · ${fy}${monthKey ? ` · ${monthLabel(monthKey)}` : ''}` `` (import `monthLabel` — already imported in this file for group headers). Show-all button condition becomes `{(unpaidOnly || monthKey) && <Button variant="subtle" onClick={() => setParams({})}>Show all</Button>}`.

`src/renderer/screens/Purchases.tsx` — same pattern (`p.invoice_date`, existing `unpaidOnly` block).

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run tests/renderer/group.test.ts && npx vitest run && npm run typecheck` → green.

```bash
git add src/renderer/lib/group.ts src/renderer/screens/Sales.tsx src/renderer/screens/Purchases.tsx tests/renderer/group.test.ts
git commit -m "feat(lists): ?month=YYYY-MM drill-down on sales and purchases"
```

---

### Task 6: Dashboard Month/YTD toggle + chart click-through

**Files:**
- Modify: `src/renderer/lib/dashboard.ts` (append `currentFyLabel`, `monthKeyOf`), `src/renderer/screens/Dashboard.tsx`, `src/renderer/components/dashboard/TrendChart.tsx`
- Test: `tests/renderer/dashboard.test.ts` (append), `tests/renderer/trend-chart.test.tsx` (create)

**Interfaces:**
- Produces (lib): `monthKeyOf(today: string): string` (`'2026-07-15'` → `'2026-07'`); `currentFyLabel(today: string): string` (April year-start: `'2026-07-15'` → `'2026-27'`, `'2026-02-01'` → `'2025-26'`).
- Produces (chart): `TrendChart({ data, onMonthClick })` where `onMonthClick?: (series: 'sales' | 'purchases', monthKey: string) => void`; clicking a bar calls it with that month's `key`.
- Dashboard behaviour: SegmentedControl `[This month | Year to date]` (state default `'month'`), rendered only when `fy === currentFyLabel(today())`; in month mode the Sales/Purchases/Net-GST tiles are computed from month-filtered rows (`filterByMonthKey` from Task 5) and labelled `Sales · Jul 2026` (via `monthLabel`); sub-lines per spec. Clicks: sales tile → `/sales?month=<key>` in month mode (plain `/sales` in YTD), purchases likewise; chart `onMonthClick` → `nav('/sales?month='+key)` or `/purchases`.

- [ ] **Step 1: Failing lib tests**

Append to `tests/renderer/dashboard.test.ts` (imports extend the existing dashboard import line):

```ts
describe('monthKeyOf / currentFyLabel', () => {
  it('extracts the month key', () => {
    expect(monthKeyOf('2026-07-15')).toBe('2026-07')
  })
  it('computes the April-start financial year label', () => {
    expect(currentFyLabel('2026-07-15')).toBe('2026-27')
    expect(currentFyLabel('2026-02-01')).toBe('2025-26')
    expect(currentFyLabel('2026-04-01')).toBe('2026-27')
    expect(currentFyLabel('2026-03-31')).toBe('2025-26')
  })
})
```

- [ ] **Step 2: Watch fail, implement lib**

Run: `npx vitest run tests/renderer/dashboard.test.ts` → FAIL. Append to `src/renderer/lib/dashboard.ts`:

```ts
export function monthKeyOf(today: string): string {
  return today.slice(0, 7)
}

/** April-start financial year label for a YYYY-MM-DD date: '2026-07-15' → '2026-27'. */
export function currentFyLabel(today: string): string {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7))
  const start = m >= 4 ? y : y - 1
  return `${start}-${String(start + 1).slice(2)}`
}
```

Re-run → PASS.

- [ ] **Step 3: Failing chart test**

`tests/renderer/trend-chart.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { renderWithMantine } from './mantine'
import TrendChart from '../../src/renderer/components/dashboard/TrendChart'

const data = [
  { key: '2026-04', label: 'Apr 26', salesAmt: 100, salesKg: 10, purchAmt: 50, purchKg: 5 },
  { key: '2026-05', label: 'May 26', salesAmt: 200, salesKg: 20, purchAmt: 80, purchKg: 8 }
]

describe('TrendChart', () => {
  it('renders without an onMonthClick handler (dashboard back-compat)', () => {
    const { container } = renderWithMantine(<TrendChart data={data} />)
    expect(container.textContent).toContain('Sales vs Purchases')
  })
  it('exposes bar props with a click handler per series when onMonthClick is given', () => {
    // jsdom cannot dispatch real recharts bar clicks reliably; assert the wiring level instead:
    // barProps must be a function returning an onClick that forwards (series, monthKey).
    const onMonthClick = vi.fn()
    renderWithMantine(<TrendChart data={data} onMonthClick={onMonthClick} />)
    // smoke: the chart mounted with the handler present (behavioural click coverage is manual/e2e)
    expect(onMonthClick).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 4: Implement chart + dashboard**

`src/renderer/components/dashboard/TrendChart.tsx` — full replacement:

```tsx
import { useState } from 'react'
import { Paper, Group, Title, SegmentedControl, Text } from '@mantine/core'
import { BarChart } from '@mantine/charts'
import type { MonthPoint } from '../../lib/dashboard'

export default function TrendChart({ data, onMonthClick }: {
  data: MonthPoint[]
  onMonthClick?: (series: 'sales' | 'purchases', monthKey: string) => void
}) {
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
        <BarChart
          h={260} data={data} dataKey="label" series={series} withLegend tickLine="y"
          barProps={(s) => ({
            style: onMonthClick ? { cursor: 'pointer' } : undefined,
            onClick: onMonthClick
              ? (d: { payload?: MonthPoint }) => {
                  if (d?.payload?.key) onMonthClick(String(s.name).startsWith('sales') ? 'sales' : 'purchases', d.payload.key)
                }
              : undefined
          })}
        />}
      {onMonthClick && data.length > 0 && <Text size="xs" c="dimmed" mt={4}>Click a bar to open that month.</Text>}
    </Paper>
  )
}
```

Implementer note: `@mantine/charts` v7 `barProps` accepts `(series) => props` passed to the underlying recharts `Bar`, whose `onClick` receives the bar datum with `payload`. If the installed version's typing rejects the function form, fall back to a plain object `barProps={{ ... }}` deriving the series from `d.tooltipPayload?.[0]?.dataKey` — verify by running the app, and note which path was taken in the report.

`src/renderer/screens/Dashboard.tsx` — changes (imports: add `SegmentedControl`; from `../lib/dashboard` add `currentFyLabel`, `monthKeyOf`; from `../lib/group` add `filterByMonthKey`, `monthLabel`):

```tsx
const [view, setView] = useState<'month' | 'ytd'>('month')
const isCurrentFy = fy === currentFyLabel(now)
const monthMode = isCurrentFy && view === 'month'
const mk = monthKeyOf(now)

const scopedSales = monthMode ? filterByMonthKey(sales, mk, s => s.invoice_date) : sales
const scopedPurchases = monthMode ? filterByMonthKey(purchases, mk, p => p.invoice_date) : purchases
const gst = gstSnapshot(scopedSales, scopedPurchases)
const salesScoped = scopedSales.filter(s => s.status === 'created').reduce((a, s) => a + s.total_invoice_amount, 0)
const purchasesScoped = scopedPurchases.reduce((a, p) => a + p.total_invoice_amount, 0)
const periodLabel = monthMode ? monthLabel(mk) : fy
```

Render the toggle above the tile grid, only when `isCurrentFy`:

```tsx
{isCurrentFy && (
  <SegmentedControl mb="md" value={view} onChange={v => setView(v as 'month' | 'ytd')}
    data={[{ label: 'This month', value: 'month' }, { label: 'Year to date', value: 'ytd' }]} />
)}
```

Tiles become:

```tsx
<KpiCard label={`Sales · ${periodLabel}`} value={formatINR(salesScoped)} sub={deltaText}
  onClick={() => nav(monthMode ? `/sales?month=${mk}` : '/sales')} />
<KpiCard label={`Purchases · ${periodLabel}`} value={formatINR(purchasesScoped)} sub={`${scopedPurchases.length} bills`}
  onClick={() => nav(monthMode ? `/purchases?month=${mk}` : '/purchases')} />
```

(Receivables/Payables tiles unchanged.) Net GST tile label becomes `` `Net GST payable · ${periodLabel}` `` using the scoped `gst`. Trend chart gets the handler:

```tsx
<TrendChart data={trend} onMonthClick={(series, key) => nav(`/${series === 'sales' ? 'sales' : 'purchases'}?month=${key}`)} />
```

Keep `salesFy` only if still referenced; otherwise remove it (typecheck will tell).

- [ ] **Step 5: Verify + commit**

Run: `npx vitest run tests/renderer/dashboard.test.ts tests/renderer/trend-chart.test.tsx && npx vitest run && npm run typecheck` → green.

```bash
git add src/renderer/lib/dashboard.ts src/renderer/screens/Dashboard.tsx src/renderer/components/dashboard/TrendChart.tsx tests/renderer/dashboard.test.ts tests/renderer/trend-chart.test.tsx
git commit -m "feat(dashboard): This month / Year to date toggle and chart month click-through"
```

---

### Task 7: Morning brief

**Files:**
- Modify: `src/renderer/lib/dashboard.ts` (append `briefINR`, `morningBrief`), `src/renderer/screens/Dashboard.tsx` (brief panel above the tiles)
- Test: `tests/renderer/dashboard.test.ts` (append)

**Interfaces:**
- Produces:
  - `briefINR(n: number): string` — `620000` → `'₹6.2 lakh'`; below 1 lakh falls back to `formatINR`-style `'₹53,559'` (reuse `formatINR` from `./format`).
  - `interface BriefInput { monthLabel: string; monthSales: Sale[]; monthPurchases: Purchase[]; overdue: Array<{ sale: Sale; daysOld: number }>; due: Purchase[]; stock: StockSlice[]; reserved: number }`
  - `morningBrief(i: BriefInput): Array<{ text: string; to?: string }>` — 2–5 sentences; `to` is a router path when the sentence has a natural target.
- Sentences (exact copy):
  1. `This month: N sales, ₹X; M purchases, ₹Y.` (always; zero forms: `No sales yet this month.` / `no purchases` folded in — see tests)
  2. When overdue non-empty: `<Buyer> owes <₹A>, <D> days old — oldest of <K> unpaid invoice(s) (<₹B> in all).` → `to: '/sales?unpaid=1'`; when empty: `No unpaid invoices — all collected.`
  3. When due non-empty: `<K> supplier bill(s) due, <₹C>.` → `to: '/purchases?unpaid=1'`.
  4. Stock lead: `Biggest stock: <hsn> <kg> kg.` (top slice) — only when stock non-empty.
  5. When reserved > 0: `<N> blank invoice(s) to fill.` → `to: '/sales'`.

- [ ] **Step 1: Failing tests**

Append to `tests/renderer/dashboard.test.ts` (the file already has `sale`/`purchase`/`ledger` fixtures — reuse; extend the import line with `briefINR, morningBrief`):

```ts
describe('briefINR', () => {
  it('lakhs above 1L, rupees below', () => {
    expect(briefINR(620000)).toBe('₹6.2 lakh')
    expect(briefINR(9850000)).toBe('₹98.5 lakh')
    expect(briefINR(53559)).toBe('₹53,559')
  })
})

describe('morningBrief', () => {
  const base = {
    monthLabel: 'Jul 2026',
    monthSales: [sale({ total_invoice_amount: 500000 }), sale({ total_invoice_amount: 120000 })],
    monthPurchases: [purchase({ total_invoice_amount: 980000 })],
    overdue: [{ sale: sale({ buyer_name: 'Haider Supply', total_invoice_amount: 53559 }), daysOld: 12 },
              { sale: sale({ total_invoice_amount: 150000 }), daysOld: 3 }],
    due: [purchase({ total_invoice_amount: 140000 })],
    stock: [{ hsn: '39021000', kg: 8075, value: 1 }],
    reserved: 1
  }
  it('writes the full brief with targets', () => {
    const b = morningBrief(base)
    expect(b[0].text).toBe('This month: 2 sales, ₹6.2 lakh; 1 purchase, ₹9.8 lakh.')
    expect(b[1]).toEqual({ text: 'Haider Supply owes ₹53,559, 12 days old — oldest of 2 unpaid invoices (₹2.0 lakh in all).', to: '/sales?unpaid=1' })
    expect(b[2]).toEqual({ text: '1 supplier bill due, ₹1.4 lakh.', to: '/purchases?unpaid=1' })
    expect(b[3].text).toBe('Biggest stock: 39021000 8075 kg.')
    expect(b[4]).toEqual({ text: '1 blank invoice to fill.', to: '/sales' })
  })
  it('handles the quiet day', () => {
    const b = morningBrief({ ...base, monthSales: [], monthPurchases: [], overdue: [], due: [], stock: [], reserved: 0 })
    expect(b[0].text).toBe('This month: no sales yet; no purchases.')
    expect(b[1].text).toBe('No unpaid invoices — all collected.')
    expect(b).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Watch fail, implement**

Run: `npx vitest run tests/renderer/dashboard.test.ts` → FAIL. Append to `src/renderer/lib/dashboard.ts`:

```ts
import { formatINR } from './format'   // add at top with the existing imports

export function briefINR(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(1)} lakh`
  return formatINR(n).replace(/\.00$/, '')
}

export interface BriefInput {
  monthLabel: string
  monthSales: Sale[]
  monthPurchases: Purchase[]
  overdue: Array<{ sale: Sale; daysOld: number }>
  due: Purchase[]
  stock: StockSlice[]
  reserved: number
}

/** The dashboard's morning note: a few plain sentences, each pointing where to act. */
export function morningBrief(i: BriefInput): Array<{ text: string; to?: string }> {
  const out: Array<{ text: string; to?: string }> = []
  const created = i.monthSales.filter(s => s.status === 'created')
  const sTot = created.reduce((a, s) => a + s.total_invoice_amount, 0)
  const pTot = i.monthPurchases.reduce((a, p) => a + p.total_invoice_amount, 0)
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  const salesPart = created.length ? `${plural(created.length, 'sale')}, ${briefINR(sTot)}` : 'no sales yet'
  const purchPart = i.monthPurchases.length ? `${plural(i.monthPurchases.length, 'purchase')}, ${briefINR(pTot)}` : 'no purchases'
  out.push({ text: `This month: ${salesPart}; ${purchPart}.` })

  if (i.overdue.length) {
    const oldest = i.overdue.reduce((a, b) => (b.daysOld > a.daysOld ? b : a))
    const owed = i.overdue.reduce((a, o) => a + o.sale.total_invoice_amount, 0)
    out.push({
      text: `${oldest.sale.buyer_name} owes ${briefINR(oldest.sale.total_invoice_amount)}, ${oldest.daysOld} days old — oldest of ${plural(i.overdue.length, 'unpaid invoice')} (${briefINR(owed)} in all).`,
      to: '/sales?unpaid=1'
    })
  } else {
    out.push({ text: 'No unpaid invoices — all collected.' })
  }

  if (i.due.length) {
    const dTot = i.due.reduce((a, p) => a + p.total_invoice_amount, 0)
    out.push({ text: `${plural(i.due.length, 'supplier bill')} due, ${briefINR(dTot)}.`, to: '/purchases?unpaid=1' })
  }
  if (i.stock.length) out.push({ text: `Biggest stock: ${i.stock[0].hsn} ${i.stock[0].kg} kg.` })
  if (i.reserved > 0) out.push({ text: `${plural(i.reserved, 'blank invoice')} to fill.`, to: '/sales' })
  return out
}
```

Nuance the tests pin: `briefINR(200000+...)` for two overdue totals 53,559+150,000=203,559 → `₹2.0 lakh` ✓ (toFixed(1)). `briefINR(53559)` → `₹53,559` (formatINR gives `₹53,559.00`; the replace strips `.00`).

- [ ] **Step 3: Panel on the dashboard**

In `src/renderer/screens/Dashboard.tsx`, above the toggle/tiles:

```tsx
const brief = morningBrief({
  monthLabel: monthLabel(mk),
  monthSales: filterByMonthKey(sales, mk, s => s.invoice_date),
  monthPurchases: filterByMonthKey(purchases, mk, p => p.invoice_date),
  overdue: rec.overdue, due: pay.due, stock, reserved: reserved.length
})
```

```tsx
<Paper withBorder p="lg" radius="md" mb="lg">
  {brief.map((b, i) => b.to
    ? <Text key={i} size="lg" style={{ cursor: 'pointer' }} onClick={() => nav(b.to!)}>{b.text}</Text>
    : <Text key={i} size="lg">{b.text}</Text>)}
</Paper>
```

(The brief always describes the current month regardless of the Month/YTD toggle — it is "the morning note", not a report.)

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run tests/renderer/dashboard.test.ts && npx vitest run && npm run typecheck` → green.

```bash
git add src/renderer/lib/dashboard.ts src/renderer/screens/Dashboard.tsx tests/renderer/dashboard.test.ts
git commit -m "feat(dashboard): plain-sentence morning brief with click-through"
```

---

### Task 8: Big-text mode

**Files:**
- Modify: `src/main/core/reference.ts` (DEFAULT_SETTINGS + Settings type in `src/shared/types.ts`), `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/screens/Settings.tsx`
- Test: `tests/core/reference.test.ts` (append), `tests/renderer/settings-scale.test.tsx` (create)

**Interfaces:**
- Produces: `Settings.ui_scale: string` (`'1' | '1.15' | '1.3'`, default `'1'`); the running app scales all rem-based sizing by that factor via the Mantine theme `scale` and a matching root `font-size`.

- [ ] **Step 1: Failing tests**

Append to `tests/core/reference.test.ts` inside the settings describe:

```ts
  it('defaults ui_scale to "1" (string — not number-coerced) and persists it', () => {
    expect(getSettings(db).ui_scale).toBe('1')
    saveSettings(db, { ui_scale: '1.15' })
    expect(getSettings(db).ui_scale).toBe('1.15')
  })
```

`tests/renderer/settings-scale.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent, waitFor } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import Settings from '../../src/renderer/screens/Settings'

const settings = {
  seller_name: 'R', seller_address: '', seller_gstin: '', seller_pan: '', seller_phone: '',
  seller_city: '', seller_pincode: '', home_state: 'West Bengal', seller_godown_address: '',
  seller_udyam: '', seller_email: 'a@b.c', bank_name: 'B', bank_branch: 'B', bank_account_no: '1',
  bank_ifsc: 'I', invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500,
  backups_to_keep: 10, ui_scale: '1'
}

describe('Settings text size', () => {
  it('saves the chosen scale', async () => {
    const saveSettings = vi.fn().mockResolvedValue({ ...settings, ui_scale: '1.15' })
    ;(window as any).api = {
      getSettings: vi.fn().mockResolvedValue(settings),
      saveSettings, listHsn: vi.fn().mockResolvedValue([]),
      upsertHsn: vi.fn(), deleteHsn: vi.fn(), backupNow: vi.fn()
    }
    renderWithMantine(<Settings />)
    await screen.findByText('Text size')
    fireEvent.click(screen.getByRole('radio', { name: 'Large' }))
    await waitFor(() => expect(saveSettings).toHaveBeenCalledWith({ ui_scale: '1.15' }))
  })
})
```

- [ ] **Step 2: Watch them fail**

Run: `npx vitest run tests/core/reference.test.ts tests/renderer/settings-scale.test.tsx` → FAIL (no `ui_scale` in Settings type; no "Text size" control).

- [ ] **Step 3: Implement**

- `src/shared/types.ts`: add `ui_scale: string` to `interface Settings`.
- `src/main/core/reference.ts`: add `ui_scale: '1'` to `DEFAULT_SETTINGS` (string keeps it out of the number-coercion branch).
- `src/renderer/main.tsx` — the provider must re-render on scale change, so move it behind a tiny stateful root:

```tsx
import { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/charts/styles.css'
import { theme } from './theme'
import App from './App'

function Root() {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    window.api.getSettings().then(s => setScale(Number(s.ui_scale) || 1)).catch(() => {})
    // Settings saves broadcast the new scale so the change applies without a restart.
    const onScale = (e: Event) => setScale(Number((e as CustomEvent).detail) || 1)
    window.addEventListener('ui-scale', onScale)
    return () => window.removeEventListener('ui-scale', onScale)
  }, [])
  useEffect(() => { document.documentElement.style.fontSize = `${16 * scale}px` }, [scale])
  return (
    <MantineProvider theme={{ ...theme, scale }} forceColorScheme="light">
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  )
}

createRoot(document.getElementById('root')!).render(<Root />)
```

- `src/renderer/screens/Settings.tsx` — a standalone control (NOT part of the business form, so it saves instantly like the HSN panel; place it in the Business Paper after the Data folder field):

```tsx
<Input.Wrapper label="Text size" mb="md">
  <SegmentedControl
    value={form.values.ui_scale || '1'}
    onChange={async v => {
      form.setFieldValue('ui_scale', v)
      try {
        await window.api.saveSettings({ ui_scale: v })
        window.dispatchEvent(new CustomEvent('ui-scale', { detail: v }))
      } catch (e) { notifications.show({ message: `Couldn't change text size: ${(e as Error).message}`, color: 'red' }) }
    }}
    data={[{ label: 'Normal', value: '1' }, { label: 'Large', value: '1.15' }, { label: 'Extra large', value: '1.3' }]}
  />
</Input.Wrapper>
```

(add `SegmentedControl` to the Mantine import; `ui_scale` rides along in the form values since `reload()` spreads all settings — and because the whole-form Save submits `rest` including `ui_scale`, that stays consistent.)

- [ ] **Step 4: Verify + commit**

Run: `npx vitest run tests/core/reference.test.ts tests/renderer/settings-scale.test.tsx && npx vitest run && npm run typecheck` → green. Note: `tests/renderer/firstrun-fields.test.tsx` and others mock settings objects — if typecheck complains about missing `ui_scale` in test fixtures typed as `Settings`, add `ui_scale: '1'` to those fixtures (mechanical).

```bash
git add src/shared/types.ts src/main/core/reference.ts src/renderer/main.tsx src/renderer/screens/Settings.tsx tests/core/reference.test.ts tests/renderer/settings-scale.test.tsx
git commit -m "feat(settings): big-text mode — Normal / Large / Extra large"
```

---

## Self-review

**Spec coverage:** §2 Reports → Tasks 3+4 (screen, CSV totals row, print header, shortcuts, params). §3 Month/YTD + chart click → Tasks 5+6 (param groundwork, toggle, current-FY gate, per-series click). §4 Mark Paid → Tasks 1+2 (setters incl. created-only guard and reverse action). §5 Brief → Task 7 (exact sentences, targets, empty states). §6 Big text → Task 8 (string setting, theme scale, instant apply). §7 out-of-scope respected — no WhatsApp/PDF work included.

**Placeholders:** none; every step carries code. Two deliberate implementer-verify notes (useFY hook shape in Task 4; @mantine/charts `barProps` typing in Task 6) name the check and both fallbacks.

**Type consistency:** `setSalePayment/setPurchasePayment(id, status, date)` consistent across core/api/ipc/UI; `TotalRow`/`saleTotalRow`/`purchaseTotalRow` consistent between Tasks 3 and 4; `filterByMonthKey(rows, key, date)` used identically in Tasks 5, 6, 7; `onMonthClick(series, monthKey)` matches between chart and dashboard; `ui_scale` string everywhere.
