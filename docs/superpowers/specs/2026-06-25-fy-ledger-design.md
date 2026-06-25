# Financial-Year Ledger Views — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review
**Sub-project:** D of the refinement batch (A Suppliers, B sale fixes, C plain-English errors merged; E form-migration parked).

## 1. Purpose

The business keeps its books by **financial year** (FY, 1 Apr – 31 Mar). The data
foundation is already FY-aware — every purchase/sale carries an `fy_label`, numbering
resets per FY — but the **views are not**: the registers list all years and the
dashboard filters by calendar month. Add a **selected financial year** the user can
switch, scoping the registers and dashboard to it, while **stock carries forward**
across years.

## 2. Decisions (locked)

- **Global selected FY** held in a renderer context; default = the **current** FY
  (`financialYear(today())`). A compact dropdown in the sidebar switches it; it is a
  **view filter** only.
- **Not persisted** across launches — each launch opens on the current FY (users work
  mostly in the current year).
- **Registers (Purchases, Sales) and the Dashboard are FY-scoped** to the selected FY.
- **Stock is live / carry-forward — NOT FY-scoped.** It always shows what is physically
  on hand now (lots from any year that still have balance). No closing-stock snapshot.
- **An entry is filed under its invoice date's FY** (accounting-correct), independent of
  the selected view. New forms still default the date to today.
- Backend list queries gain an **optional** `fyLabel` (no arg = all rows, so existing
  callers/tests are unaffected). No schema change.

## 3. FY rollover & stock carry-forward (how a new year begins)

This is why the carry-forward "just works" and needs no manual step:

- **Stock is lot-based and date-driven, not FY-bound.** `listAvailableLots(asOfDate)`
  already returns every lot with remaining quantity as of the sale date, regardless of
  the FY it was purchased in. A lot bought in 2024-25 with balance left is sellable in
  2025-26 automatically.
- **The current FY is always present in the selector**, even with zero transactions. So
  on 1 Apr the app opens on the new (empty) FY: its registers are fresh, numbering
  restarts at 0001, and the **Stock screen still shows all carried-over lots**.
- **A new sale in the new FY draws directly from prior-year lots** via the same stock
  table; no opening-balance entry, no migration. The Stock screen caption makes the
  carry-forward explicit ("Current stock on hand — all years").

## 4. Backend (`src/main/core`)

- **`listFinancialYears(db): string[]`** (new, in `financial-year.ts` or `reference.ts`):
  ```sql
  SELECT DISTINCT fy_label FROM
    (SELECT fy_label FROM purchases UNION SELECT fy_label FROM sales)
  ORDER BY fy_label DESC
  ```
  Returns the distinct labels with data, newest first (may be empty on a fresh DB).
- **`listPurchases(db, fyLabel?)`** — when `fyLabel` is provided, add `WHERE fy_label = ?`
  (keep `ORDER BY invoice_date DESC, id DESC`).
- **`listSales(db, fyLabel?)`** — when provided, add `WHERE fy_label = ?` (keep
  `ORDER BY fy_label DESC, seq DESC`).

## 5. API / IPC

- `src/shared/api.ts`: `listFinancialYears(): Promise<string[]>`; change
  `listPurchases(fyLabel?: string)` and `listSales(fyLabel?: string)`. Add
  `listFinancialYears` to `CHANNELS`.
- `src/main/ipc.ts`: `h('listFinancialYears', () => listFinancialYears(db()))`;
  `h('listPurchases', (fyLabel) => listPurchases(db(), fyLabel))`;
  `h('listSales', (fyLabel) => listSales(db(), fyLabel))`.
- `tests/core/api-shape.test.ts` adds `listFinancialYears`.

## 6. Renderer — FY context + selector

- **`src/renderer/fy.tsx`** — `FYProvider` + `useFY()` hook exposing `{ fy, setFy, years }`:
  - On mount, fetch `window.api.listFinancialYears()`, compute the current label with
    `financialYear(today()).label` (import `financialYear` from `../main/core/financial-year`
    — the renderer already imports pure helpers from `main/core`, e.g. NewSale), union the
    two, dedupe, sort **desc**, store in `years`; initialise `fy` to the current label.
  - `fy` is a `YYYY-YY` string (e.g. `2025-26`).
- **`src/renderer/components/FYSelect.tsx`** — a small Mantine `Select` (not searchable,
  compact) bound to `useFY()`; rendered in `Sidebar` under the title.
- **`App.tsx`** wraps the authenticated shell (the `<AppShell>`…`</AppShell>` tree) in
  `<FYProvider>` so every screen and the sidebar share one FY. (FirstRun stays outside.)

## 7. Renderer — scoped screens

- **`Purchases.tsx` / `Sales.tsx`**: read `fy` from `useFY()`; `reload()` calls
  `listPurchases(fy)` / `listSales(fy)`; `useEffect` depends on `fy`; the `PageHeader`
  title shows the FY (e.g. `Purchases · 2025-26`). Empty-state copy unchanged.
- **`Dashboard.tsx`**: read `fy` from `useFY()`; pass `fy` to `listPurchases`/`listSales`.
  KPIs become FY-scoped: the "Sales this month" card becomes **"Sales · {fy}"** (sum of
  created sales in that FY), and the pending-payment counts reflect that FY's rows.
  **"Stock on hand" and "Low stock" stay live** (they use `stockLedger()`, unchanged).
- **`Stock.tsx`**: unchanged data; add a caption under the header —
  "Current stock on hand — all years (stock carries forward across financial years)."

## 8. Out of scope

- Historical closing-stock as-of an FY end (decided: stock is live).
- Persisting the selected FY across launches (decided: default to current FY).
- Any change to tax, numbering, draw-down, the invoice template, or the schema.
- A separate "year-end close" / opening-balance workflow (carry-forward is automatic).

## 9. Testing

- **Core:** `listFinancialYears` returns distinct labels newest-first across the union of
  purchases and sales (seed two FYs in each, assert order + dedupe; empty DB → `[]`).
  `listPurchases(fy)` / `listSales(fy)` return only that FY's rows; with no arg return all
  (a regression test that the existing all-rows behaviour is preserved).
- **Renderer:** an `FYSelect`/`FYProvider` render test (wrapped in `renderWithMantine`)
  that, given a stubbed `window.api.listFinancialYears`, shows the current FY as the
  default selection and lists the returned years. (Follows the existing
  `tests/renderer/*.tsx` + `window.api` stub pattern.)
- **api-shape** includes `listFinancialYears`.
- Full suite + `npm run typecheck` + `npm run build` stay green. Operator manual pass:
  switch the FY dropdown → registers + dashboard re-scope; Stock stays full; a sale in the
  current FY can still draw a prior-FY lot.

## 10. Open items

None.
