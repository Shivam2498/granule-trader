# Group Sales & Purchases Registers by Month — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review

## 1. Purpose

The Sales and Purchases registers show a flat list of rows for the selected financial
year. Group those rows by **calendar month**, with a band header per month that also
carries a **monthly subtotal** (total kg + total ₹) — a clearer, ledger-style view.

## 2. Decisions (locked)

- **Group by `invoice_date`'s month** (`YYYY-MM`). Rows with no date (reserved sales)
  fall into an `'undated'` bucket.
- **Group order:** the `'undated'` bucket first (if any), then months **newest → oldest**.
  Row order **within** a month is preserved (the list already arrives date/seq-sorted).
- **Band header per group:** a full-width row showing `"<Month YYYY> — <kg> kg · <₹>"`
  for month groups; the undated bucket's header reads **"Reserved"** with no totals.
- **Subtotal** = sum of that month's rows: Sales → `total_qty_kg` + `total_invoice_amount`;
  Purchases → `qty_kg` + `total_invoice_amount`. (Reserved sales contribute nothing and
  sit only under the "Reserved" header.)
- **Renderer-only.** No backend/IPC/schema change; it groups the already-FY-scoped,
  date-sorted list each screen fetches.

## 3. Shared helper — `src/renderer/lib/group.ts`

```ts
export interface MonthGroup<T> { key: string; items: T[] }

// Buckets by the YYYY-MM of getDate(item); null/empty date → key 'undated'.
// Order: 'undated' first (when present), then YYYY-MM keys descending.
// Input order is preserved within each group.
export function groupByMonth<T>(items: T[], getDate: (t: T) => string | null | undefined): MonthGroup<T>[]

// 'undated' → 'Undated'; 'YYYY-MM' → 'June 2026' (month-name array, locale-independent).
export function monthLabel(key: string): string
```

- `monthLabel` uses a fixed `MONTHS` array (`['January', … 'December']`) indexed by the
  month number, so output is deterministic and unit-testable (no `Date`/locale).
- The screen renders the band label as `key === 'undated' ? 'Reserved' : monthLabel(key)`.

## 4. Sales register (`src/renderer/screens/Sales.tsx`)

- `const groups = groupByMonth(list, s => s.invoice_date)`.
- For each group, render a **band header `Table.Tr`** (one `Table.Td colSpan={7}`, styled
  bold + subtle background) then the group's rows using the existing reserved/created
  row markup. Month bands show `"<label> — <Σ total_qty_kg> kg · <formatINR(Σ total_invoice_amount)>"`;
  the `'undated'` band shows just `"Reserved"`.
- Empty state (`list.length === 0`) unchanged: "No sales yet."

## 5. Purchases register (`src/renderer/screens/Purchases.tsx`)

- `const groups = groupByMonth(list, p => p.invoice_date)`.
- Band header `Table.Tr` (one `Table.Td colSpan={9}`) per month with
  `"<label> — <Σ qty_kg> kg · <formatINR(Σ total_invoice_amount)>"`, then the existing
  rows. No undated bucket (purchases always have a date). Empty state unchanged.

## 6. Band styling

A `Table.Tr` whose single `Table.Td colSpan={N}` uses a light background
(`bg="var(--mantine-color-gray-1)"`) and bold text (`fw={700}`). Quantities shown as a
plain number + " kg"; amounts via `formatINR`.

## 7. Out of scope

- Any backend/query change (grouping is client-side on the FY-scoped list).
- A FY-wide grand total, collapsing/expanding groups, or per-day grouping.
- Changing the row columns, sort source, or the reserved-fill / delete actions.

## 8. Testing

- **Unit (`tests/renderer/group.test.ts`):** `groupByMonth` buckets by month, puts
  `'undated'` first then months descending, preserves within-group order; `monthLabel`
  maps `'2026-06'` → `'June 2026'` and `'undated'` → `'Undated'`.
- The two screens are verified by `npm run typecheck` + the suite staying green +
  `npm run build`, and an operator pass (month bands with correct subtotals; reserved
  invoices under a "Reserved" band; switching FY re-groups).

## 9. Open items

None.
