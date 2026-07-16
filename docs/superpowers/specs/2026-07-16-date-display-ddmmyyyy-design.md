# DD/MM/YYYY Date Display — Design

**Date:** 2026-07-16
**Status:** Approved in conversation; awaiting owner review of this document

## 1. Purpose

Show every user-facing date as **DD/MM/YYYY** (e.g. `16/04/2026`) instead of the ISO
`YYYY-MM-DD` the app currently displays. Storage does not change — this is a display-layer
change only.

## 2. Approach: display-only, storage stays ISO

Dates remain stored and passed around as ISO `YYYY-MM-DD` strings. This is load-bearing:

- text-sortability drives the Sales/Purchases ordering (`invoice_date.localeCompare(...)`),
- month grouping/filtering relies on `startsWith('YYYY-MM')` (`groupByMonth`, `filterByMonthKey`),
- the sales migration and `daysBetween` age math both assume ISO.

A single formatter converts ISO → DD/MM/YYYY at the moment of display. Nothing upstream of a
render or a CSV cell ever sees the formatted string.

## 3. The formatter

Add to `src/renderer/lib/format.ts` (beside `today()` / `formatINR`):

```
formatDate(iso: string | null | undefined): string
```

- `'2026-04-16'` → `'16/04/2026'`
- `''` / `null` / `undefined` → `''`
- Any value not matching `^\d{4}-\d{2}-\d{2}$` is returned unchanged (defensive: a stray or
  already-formatted value never throws inside a table cell).

## 4. Display surfaces (all four, per owner)

1. **On-screen tables** — wrap the date cell in `formatDate(...)`:
   - `Sales.tsx` (invoice_date cell), `Purchases.tsx` (invoice_date cell),
     `Stock.tsx` (invoice_date cell), `StockAdjust.tsx` (adjustment `date` cell),
     `LotSelect.tsx` (invoice_date cell). Month group headers already use `monthLabel` (month +
     year, no day) — unchanged.
2. **Printed invoice / PDF** — `InvoiceTemplate.tsx`: `formatDate(sale.invoice_date)` and
   `formatDate(sale.eway_bill_date)`.
3. **CSV / report downloads** — in `src/renderer/lib/csv.ts`, the `Date` and `Payment date`
   value functions (sales and purchases columns) wrap their output in `formatDate`. The coming
   Reports screen reuses these column definitions, so it inherits the format for free.
   (Owner accepted the trade-off that a spreadsheet may re-interpret a DD/MM/YYYY text cell.)
4. **Date picker** — `DateField.tsx`: `valueFormat="DD/MM/YYYY"`. The `onChange` still emits ISO
   (its conversion from the picked `Date` is unchanged), so every consumer keeps receiving ISO.
   Build-time check: typing a `DD/MM/YYYY` date into the field must parse to the correct day
   (Mantine `DateInput` parses typed input per `valueFormat`; verify, and if needed pass a
   matching `dateParser`).

## 5. Not touched

- `created_at` — an internal audit timestamp, never shown to the user.
- All storage, IPC payloads, core logic, sorting, month keys, migration code — untouched.

## 6. Testing

- **Unit:** `formatDate` — ISO→`DD/MM/YYYY`, empty/null→`''`, non-ISO passthrough
  (`tests/renderer/format.test.ts`, creating it if absent).
- **Existing tests to update** (they assert raw ISO in output):
  - `tests/renderer/csv.test.ts` — the sales row expects `'2026-06-10'` (→ `'10/06/2026'`); the
    purchase row expects `'2026-06-10'` and `'2026-06-12'` (→ `'10/06/2026'`, `'12/06/2026'`).
    The null-date case still expects `''`.
  - `tests/renderer/invoice-template.test.tsx` — if any assertion checks the rendered date text,
    update it to the slash format (the fixture date is `2025-04-14` → `14/04/2025`).
- **Regression:** the full suite must stay green after the call-site changes; the picker's
  emitted value (ISO) is covered by the unchanged sale/purchase create flows.
