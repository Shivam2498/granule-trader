# DD/MM/YYYY Date Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show every user-facing date as DD/MM/YYYY while keeping ISO `YYYY-MM-DD` in storage.

**Architecture:** One pure formatter (`formatDate`) converts ISO → DD/MM/YYYY at the point of display. It is applied at the CSV columns and every UI date render (tables, printed invoice, date picker). No storage, IPC, sorting, month-key, or migration code changes — those keep seeing ISO. Spec: `docs/superpowers/specs/2026-07-16-date-display-ddmmyyyy-design.md`.

**Tech Stack:** React 18, Mantine 7 (`@mantine/dates` DateInput), Vitest + Testing Library (`fireEvent`; renderer tests need `// @vitest-environment jsdom`).

## Global Constraints

- **Display-only.** Dates stay stored/passed as ISO `YYYY-MM-DD`. Never feed `formatDate`'s output back into storage, sorting, `startsWith` month filters, `groupByMonth`, `filterByMonthKey`, `daysBetween`, or any IPC payload.
- **Format:** `DD/MM/YYYY` with slashes (e.g. `16/04/2026`).
- **Formatter contract:** `formatDate(iso: string | null | undefined): string` — ISO→`DD/MM/YYYY`; empty/null/undefined→`''`; any value not matching `^\d{4}-\d{2}-\d{2}$` returned unchanged.
- `created_at` is never reformatted (internal audit timestamp, not shown).
- Run `npx vitest run <file>` while iterating and `npx vitest run` + `npm run typecheck` before each commit. NEVER `npm test`. Commit to master (repo convention).

## File structure

- `src/renderer/lib/format.ts` — add `formatDate` (Task 1).
- `src/renderer/lib/csv.ts` — wrap the two `Date`/`Payment date` columns per entity (Task 1).
- `src/renderer/screens/{Sales,Purchases,Stock,StockAdjust,LotSelect}.tsx` — wrap the date cell (Task 2).
- `src/renderer/invoice/InvoiceTemplate.tsx` — wrap invoice + e-way dates (Task 2).
- `src/renderer/components/DateField.tsx` — `valueFormat="DD/MM/YYYY"` (Task 2).

---

### Task 1: `formatDate` helper + CSV columns

**Files:**
- Modify: `src/renderer/lib/format.ts` (append), `src/renderer/lib/csv.ts`
- Test: `tests/renderer/format.test.ts` (create), `tests/renderer/csv.test.ts` (update two assertions)

**Interfaces:**
- Produces: `formatDate(iso: string | null | undefined): string` — used by every later date render.

- [ ] **Step 1: Write the failing formatter test**

Create `tests/renderer/format.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { formatDate } from '../../src/renderer/lib/format'

describe('formatDate', () => {
  it('converts ISO to DD/MM/YYYY', () => {
    expect(formatDate('2026-04-16')).toBe('16/04/2026')
    expect(formatDate('2025-12-01')).toBe('01/12/2025')
  })
  it('returns empty for empty, null or undefined', () => {
    expect(formatDate('')).toBe('')
    expect(formatDate(null)).toBe('')
    expect(formatDate(undefined)).toBe('')
  })
  it('passes through anything that is not an ISO date', () => {
    expect(formatDate('16/04/2026')).toBe('16/04/2026')   // already formatted
    expect(formatDate('not a date')).toBe('not a date')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/renderer/format.test.ts`
Expected: FAIL — no export `formatDate`.

- [ ] **Step 3: Implement the formatter**

Append to `src/renderer/lib/format.ts`:

```ts
/** ISO 'YYYY-MM-DD' → display 'DD/MM/YYYY'. Storage stays ISO; this is display-only.
 *  Empty/null/undefined → ''; anything not ISO-shaped is returned unchanged (defensive). */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/renderer/format.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wrap the CSV date columns**

In `src/renderer/lib/csv.ts`, add `formatDate` to the existing import from `./dashboard`? No — it lives in `./format`. Add a new import line after the existing imports:

```ts
import { formatDate } from './format'
```

Change the four date value functions:

- `salesColumns` `Date`: `{ header: 'Date', value: s => formatDate(s.invoice_date) }`
- `salesColumns` `Payment date`: `{ header: 'Payment date', value: s => formatDate(s.payment_date) }`
- `purchaseColumns` `Date`: `{ header: 'Date', value: p => formatDate(p.invoice_date) }`
- `purchaseColumns` `Payment date`: `{ header: 'Payment date', value: p => formatDate(p.payment_date) }`

(`formatDate(null)` returns `''`, so the existing `?? ''` guards are no longer needed and are removed by this change.)

- [ ] **Step 6: Update the CSV test assertions**

In `tests/renderer/csv.test.ts`:
- The sales-row test currently expects `'2026-06-10'` in the Date position — change that element to `'10/06/2026'`.
- The purchase-row test currently expects `'2026-06-10'` (Date) and `'2026-06-12'` (Payment date) — change to `'10/06/2026'` and `'12/06/2026'`.
- The null-invoice-date test still expects `''` (unchanged — `formatDate(null)` returns `''`).

- [ ] **Step 7: Run and commit**

Run: `npx vitest run tests/renderer/format.test.ts tests/renderer/csv.test.ts && npm run typecheck`
Expected: PASS, typecheck clean.

```bash
git add src/renderer/lib/format.ts src/renderer/lib/csv.ts tests/renderer/format.test.ts tests/renderer/csv.test.ts
git commit -m "feat(dates): formatDate helper (DD/MM/YYYY) applied to CSV exports"
```

---

### Task 2: Apply DD/MM/YYYY at every UI surface

**Files:**
- Modify: `src/renderer/screens/Sales.tsx`, `Purchases.tsx`, `Stock.tsx`, `StockAdjust.tsx`, `LotSelect.tsx`, `src/renderer/invoice/InvoiceTemplate.tsx`, `src/renderer/components/DateField.tsx`
- Test: full renderer suite must stay green (no assertion currently checks a rendered raw date except the CSV ones handled in Task 1 — verified: `tests/renderer/invoice-template.test.tsx` asserts only 'Original'/'Duplicate', not the date).

**Interfaces:**
- Consumes: `formatDate` from Task 1.

- [ ] **Step 1: Wrap the on-screen table cells**

All five screens already import from `../lib/format`; add `formatDate` to each existing import from that module (e.g. `import { formatINR, formatDate } from '../lib/format'`).

- `src/renderer/screens/Sales.tsx:74` — `<Table.Td>{s.invoice_date}</Table.Td>` → `<Table.Td>{formatDate(s.invoice_date)}</Table.Td>`
- `src/renderer/screens/Purchases.tsx:65` — `<Table.Td>{p.invoice_date}</Table.Td>` → `<Table.Td>{formatDate(p.invoice_date)}</Table.Td>`
- `src/renderer/screens/Stock.tsx:46` — `<Table.Td>{r.invoice_date}</Table.Td>` → `<Table.Td>{formatDate(r.invoice_date)}</Table.Td>`
- `src/renderer/screens/StockAdjust.tsx:104` — `<Table.Td>{a.date}</Table.Td>` → `<Table.Td>{formatDate(a.date)}</Table.Td>`
- `src/renderer/screens/LotSelect.tsx:138` — `<Table.Td>{l.invoice_date}</Table.Td>` → `<Table.Td>{formatDate(l.invoice_date)}</Table.Td>` (leave line 139's `daysBetween(l.invoice_date, ...)` alone — it needs ISO).

- [ ] **Step 2: Wrap the printed invoice dates**

`src/renderer/invoice/InvoiceTemplate.tsx` — add `import { formatDate } from '../lib/format'` after the `rupeesInWords` import. Then:
- line 83: `<td>Date</td><td>{sale.invoice_date}</td>` → `<td>Date</td><td>{formatDate(sale.invoice_date)}</td>`
- line 84: `<td>Date</td><td>{sale.eway_bill_date ?? ''}</td>` → `<td>Date</td><td>{formatDate(sale.eway_bill_date)}</td>`

- [ ] **Step 3: Show DD/MM/YYYY in the date picker**

`src/renderer/components/DateField.tsx` — change `valueFormat="YYYY-MM-DD"` to `valueFormat="DD/MM/YYYY"`. Leave `value` and `onChange` exactly as they are — `onChange` already converts the picked `Date` to an ISO string, so every consumer keeps receiving ISO.

- [ ] **Step 4: Verify typed-input parsing (behavioural check)**

Run the app (`npm run dev`), open New Purchase, and type a date like `16/04/2026` into the Invoice date field, then save and reopen. Confirm it round-trips to the same day (guards against a locale/parse mismatch). If typed input parses wrong, add `dateParser={(v) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim()); return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : new Date(v) }}` to the `DateInput`. Record in the report which path was taken. (Picking dates from the calendar popup is unaffected by parsing and always works.)

- [ ] **Step 5: Run the full suite and typecheck**

Run: `npx vitest run && npm run typecheck`
Expected: all green (no test asserts a raw rendered date after Task 1).

- [ ] **Step 6: Build sanity**

Run: `npm run build`
Expected: builds clean (the renderer compiles with the new imports).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/screens/Sales.tsx src/renderer/screens/Purchases.tsx src/renderer/screens/Stock.tsx src/renderer/screens/StockAdjust.tsx src/renderer/screens/LotSelect.tsx src/renderer/invoice/InvoiceTemplate.tsx src/renderer/components/DateField.tsx
git commit -m "feat(dates): show DD/MM/YYYY in tables, invoice and the date picker"
```

---

## Self-review

**Spec coverage:** §3 formatter → Task 1 Step 3. §4.1 tables → Task 2 Step 1 (all five). §4.2 invoice → Task 2 Step 2 (both dates). §4.3 CSV → Task 1 Step 5. §4.4 picker → Task 2 Steps 3–4 (valueFormat + parse verification). §6 tests → Task 1 (formatDate unit + csv update); invoice-template test confirmed not to assert the date, so no update needed there.

**Placeholder scan:** none — every step carries exact old→new text or full code. The one behavioural check (Step 4) names the concrete fallback code and how to verify.

**Type consistency:** `formatDate(iso: string | null | undefined): string` used identically at every call site; it accepts the nullable `payment_date`/`eway_bill_date` fields directly, so no `?? ''` wrappers are needed and none are introduced.
