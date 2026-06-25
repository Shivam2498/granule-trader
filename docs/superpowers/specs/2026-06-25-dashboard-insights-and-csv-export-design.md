# Dashboard Insights & CSV Export — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review

## 1. Purpose

Replace the current sub-par Dashboard (4 static KPI cards + two dead text lists)
with an interactive, insight-rich view, and add CSV export of Sales & Purchases —
per month and for the full financial year (FY).

The Dashboard is **FY-scoped** like the rest of the app; all insight widgets reflect
the currently selected FY. Everything actionable is **clickable** and drills into the
real records (no dead text).

This is two independent units, written here as **two separable phases**:
- **Phase A — Dashboard revamp** (renderer-only aggregation + charts)
- **Phase B — CSV export** (registers + a small `exportCsv` IPC)

They share no code beyond the existing `groupByMonth` helper and can ship separately.

## 2. Decisions (locked)

- **Charting:** add `@mantine/charts` (Recharts-based, themed to the existing Mantine 7 UI).
- **Computation:** renderer-only. Pure aggregation functions take the already-fetched
  `sales` / `purchases` / `ledger` arrays and return view-models. **No new IPC for the
  dashboard.** (CSV export adds one IPC — see Phase B.)
- **Payables alert rule:** a purchase is "due" when `payment_status === 'pending'` **and**
  `today − invoice_date > 2 days`.
- **Receivables:** only `created` sales with `payment_status === 'pending'`; aged by
  `invoice_date`. Reserved sales (blank, null date) are not receivables.
- **CSV content:** full GST detail, **one row per invoice/purchase** (not per line item).
  Sales span multiple HSN lots, so HSN is omitted at the sales-invoice level; purchases
  carry their single `hsn_code`.
- **CSV file write:** native Save dialog via a new `exportCsv` IPC.

## 3. Phase A — Dashboard revamp

### 3.1 Aggregation module — `src/renderer/lib/dashboard.ts`

Pure functions, each unit-tested. `today` is passed in (string `YYYY-MM-DD`) so tests are
deterministic. Day math uses date-string differencing (no locale/`Date.now`).

```ts
interface MonthPoint { key: string; label: string; salesAmt: number; salesKg: number; purchAmt: number; purchKg: number }
interface AgingBuckets { b0_30: number; b31_60: number; b60plus: number }   // ₹ totals
interface StockSlice { code: string; hsn: string; kg: number; value: number }
interface AgeBucket { bucket: '0-30' | '31-60' | '61-90' | '90+'; kg: number; value: number }

// 12 FY months (reuses groupByMonth on invoice_date); months ascending for the trend chart.
monthlyTrend(sales: Sale[], purchases: Purchase[]): MonthPoint[]

// Pending created sales, aged by invoice_date.
receivables(sales: Sale[], today: string): { total: number; buckets: AgingBuckets; overdue: Array<{ sale: Sale; daysOld: number }> }

// Pending purchases; `due` = pending AND today - invoice_date > 2 days.
payables(purchases: Purchase[], today: string): { total: number; buckets: AgingBuckets; due: Purchase[] }

// output = Σ sales (cgst+sgst+igst); input = Σ purchases (cgst+sgst+igst); net = output - input.
gstSnapshot(sales: Sale[], purchases: Purchase[]): { output: number; input: number; net: number }

// Per HSN/code: Σ balance_kg and Σ balance_kg * purchase.rate_per_kg (lot joined to its purchase by id).
stockByProduct(ledger: LedgerRow[], purchases: Purchase[]): StockSlice[]

// Per age bucket (today - lot invoice_date): kg + ₹ value (value via purchase rate).
inventoryAging(ledger: LedgerRow[], purchases: Purchase[], today: string): AgeBucket[]

lowStock(ledger: LedgerRow[], threshold: number): LedgerRow[]   // balance_kg < threshold
reservedPendingFill(sales: Sale[]): Sale[]                       // status === 'reserved'

// Current calendar month vs previous month sales total → percentage for KPI ▲▼ (null if no prior).
monthDelta(sales: Sale[], today: string): { current: number; previous: number; pct: number | null }
```

Notes:
- Stock **value** requires `rate_per_kg`, absent from `LedgerRow`; build a
  `Map<purchase_id, Purchase>` and join. Lots whose purchase is missing contribute kg only.
- Buyer **State** for sales lives in `buyer_billing_json`; a small `parseState(json)` helper
  reads it defensively (returns `''` on parse failure).
- "Created sales" = `status === 'created'` (matches existing Dashboard logic).

### 3.2 Widgets & layout (top → bottom)

1. **Header** — greeting + today + `New sale` / `New purchase` (unchanged).
2. **KPI strip** (clickable cards, each with ▲▼ vs last month where meaningful):
   - Sales · FY (₹) → Sales screen
   - Receivables outstanding (₹) → expands the receivables list
   - Stock on hand (kg + ₹ value) → Stock screen
   - Net GST payable · FY (₹) → GST breakdown (output / input / net)
3. **Action Center** — compact cards, each a count + ₹ with an inline clickable list:
   - 🔴 Payables due (>2 days) → row click → purchase edit
   - 🟠 Overdue receivables (chase) → row click → invoice
   - 🟡 Reserved invoices pending fill → row click → fill
   - 🔵 Low stock → row click → stock
4. **Charts** (`@mantine/charts`):
   - Sales vs Purchases — monthly grouped bars, `[₹ | kg]` toggle (SegmentedControl)
   - Stock by product/HSN — donut; slice click → stock
   - Receivables & Payables aging — grouped/stacked bar by bucket
5. **Inventory aging** — table: age bucket · kg · ₹ value; row click → stock.

Each widget is a small component under `src/renderer/components/dashboard/`
(e.g., `KpiStrip`, `ActionCenter`, `TrendChart`, `StockDonut`, `AgingChart`,
`InventoryAgingTable`). Dashboard composes them and owns the single data fetch.

### 3.3 Empty / error states

- Each widget renders its own empty copy ("All settled", "Nothing below X kg",
  empty-chart placeholder).
- Top-level error `Alert` is retained (existing pattern).

## 4. Phase B — CSV export

### 4.1 CSV module — `src/renderer/lib/csv.ts` (pure)

```ts
interface CsvColumn<T> { key: string; header: string; value: (row: T) => string | number }
toCsv<T>(rows: T[], columns: CsvColumn<T>[]): string   // RFC-4180 escaping: wrap in quotes when
                                                        // the cell contains " , or newline; "" escapes ".
salesCsvRows(sales: Sale[]): CsvColumn<Sale>[]          // column set below (one row per invoice)
purchasesCsvRows(purchases: Purchase[]): CsvColumn<Purchase>[]
```

- **Sales columns:** Invoice No, Date, Buyer, Buyer GSTIN, State, Qty (kg), Taxable
  (`amount`), CGST, SGST, IGST, TCS, Round-off, Total, Payment status, Payment date.
- **Purchase columns:** Code, Supplier Inv No, Date, Supplier, State, HSN, Qty (kg), Rate,
  Taxable (`amount`), CGST, SGST, IGST, TCS, Total, Payment status, Payment date.
- Amounts are emitted as plain numbers (no `₹`, no thousands grouping) for spreadsheet use.

### 4.2 Export IPC — `exportCsv`

- `exportCsv(suggestedName: string, content: string): Promise<{ saved: boolean; path?: string }>`
- Main: `dialog.showSaveDialog({ defaultPath: suggestedName, filters: [{ name: 'CSV', extensions: ['csv'] }] })`;
  on confirm, `writeFileSync(path, content, 'utf8')` and return `{ saved: true, path }`; on cancel `{ saved: false }`.
- Registered in `CHANNELS` (src/shared/api.ts), the `Api` interface, preload bridge, and the
  ipc handler. The `tests/core/api-shape.test.ts` guard enforces channel/Api parity.

### 4.3 Register UI

In `Sales.tsx` and `Purchases.tsx` (already month-grouped):
- **Per-month:** a `⭳ CSV` button in each month band header; exports that month's rows.
  Filename `Sales-June-2026.csv` / `Purchases-June-2026.csv` (via `monthLabel`).
- **Full FY:** an `Export FY` button in the page header; exports the whole list.
  Filename `Sales-FY-<fy>.csv` (e.g., `Sales-FY-2026-27.csv`).
- Buttons build rows via the csv module, then call `window.api.exportCsv(name, content)`.
- A month/FY with zero rows disables its button.

## 5. Testing

- **`tests/renderer/dashboard.test.ts`** — every aggregation fn: monthly trend buckets &
  totals; receivables/payables bucket boundaries and the **>2-day** payables rule; GST
  snapshot; stock value join (incl. missing-purchase fallback); inventory aging buckets;
  lowStock; reservedPendingFill; monthDelta (incl. null-prior).
- **`tests/renderer/csv.test.ts`** — `toCsv` escaping (quotes, commas, newlines, empty),
  and the sales/purchase column mappings.
- **`tests/core/api-shape.test.ts`** — stays green with the added `exportCsv` channel.
- Verified by `npm run typecheck` + suite green + `npm run build`, plus an operator pass:
  KPIs/charts render with correct numbers; Action Center rows navigate; ₹/kg toggle works;
  per-month and FY CSVs download with correct rows/columns; switching FY re-computes.

## 6. Out of scope

- Profitability / margins (cost-of-goods) — not selected; would need allocation-level cost.
- Top customers/suppliers, payment-behavior/DSO, stock-cover/reorder — not selected.
- Cross-FY (multi-year) trends; the trend chart covers the selected FY's months only.
- HSN-level (line-item) CSV / GSTR HSN-summary; CSV is invoice-level.
- Backend SQL aggregation for the dashboard (renderer-only by decision §2).

## 7. Open items

None.
