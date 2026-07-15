# Reports & Daily-Use Refinements — Design

**Date:** 2026-07-15
**Status:** Approved in conversation; awaiting owner review of this document

## 1. Purpose

Five features aimed at the app's primary user — the owner, who runs the business day-to-day:
party-wise reports he can hand out, a dashboard that answers "how is this month going?" at a
glance, one-click payment marking, a morning brief in plain sentences, and larger text.

Parked for later (groundwork noted in §7): WhatsApp invoice sending.

## 2. Reports — sales per customer, purchases per supplier

**New screen `/reports`** ("Reports" in the sidebar) with controls:

- **Report type:** Sales by customer | Purchases by supplier (segmented control)
- **Party:** searchable select (customers or suppliers per type)
- **Period:** FY select (reuses the FY machinery) + month select ("All months", Apr … Mar)
- Actions: **Download CSV**, **Print / PDF**

Below the controls, a **preview table** of the party's invoices for the period, rendered from the
same column definitions the CSV uses (`salesColumns` / `purchaseColumns` in
`src/renderer/lib/csv.ts`) so preview and download can never disagree. A **totals row** closes the
table: qty, taxable, CGST, SGST, IGST, invoice total. The CSV gets the same `TOTAL` row appended.

**Shortcuts:** each Customers and Suppliers row gains a **Report** button →
`/reports?type=sales&party=<id>` (resp. `type=purchases`) pre-filled.

**Print** uses a print stylesheet (like the invoice's `.no-print` pattern): controls hidden, a
header block printed — seller name, "Sales Statement — <party> — <period>", generation date —
then the table. PDF via the OS print dialog.

**Mechanics:** data from existing `listSales(fy)` / `listPurchases(fy)`, filtered client-side by
`buyer_customer_id` / `supplier_id` and month; sales include only `status = 'created'`. Logic
lives in a new pure lib `src/renderer/lib/report.ts`: `filterSalesReport` / `filterPurchasesReport`
(party + month), `reportTotals(rows)`, `fyMonths(fyLabel)` (Apr→Mar keys + labels), and the CSV
filename builder (`Sales-Jenisa-Enterprise-2026-27.csv`, `…-Apr-2026.csv`). Unit-tested without
React. No new IPC.

## 3. Dashboard — This month / Year to date

A **segmented toggle** above the tiles: **[ This month | Year to date ]**, default *This month*.
It flips the Sales, Purchases and Net GST tiles together; Receivables/Payables stay to-date
(money owed has no month). Tile labels follow the mode ("Sales · July" / "Sales · 2026-27").

- The toggle shows only when the selected FY is the **current** FY; on a past FY the tiles show
  FY totals (a month view of a closed year answers no daily question).
- Sub-lines: in month mode, "▲ 12% vs June" (existing `monthDelta`); in YTD mode, bill count.

**Chart click-through:** clicking a month in the trend chart opens that month's list — the Sales
screen for the sales series, Purchases for the purchase series — filtered to that month via a
`?month=YYYY-MM` query param, following the exact pattern of `?unpaid=1` (title changes, "Show
all" button clears). New pure helper `monthParam` filtering in the screens' existing list-derivation.

## 4. One-click Mark Paid

On Sales and Purchases list rows, the payment badge becomes actionable:

- A **pending** row shows the badge plus a small **✓ Mark paid** button; clicking opens a tiny
  confirm popover ("Mark RP/012 paid today?") → sets `payment_status='done'`,
  `payment_date=today`.
- A **paid** row's badge click offers the reverse ("Mark as pending") — misclick recovery without
  the edit screen.

**New focused IPC** rather than round-tripping full edit payloads:
`setSalePayment(id, status, date)` and `setPurchasePayment(id, status, date)` — two small core
functions in `sale.ts` / `purchase.ts` (UPDATE of the two payment columns only; sale must be
`status='created'`), registered in `ipc.ts`, `api.ts` `Api` + `CHANNELS`, and
`tests/core/api-shape.test.ts`.

## 5. Morning brief

A sentence-panel at the top of the dashboard, before the tiles — plain English the owner reads
like a note:

> This month: 8 sales, ₹6.2 lakh; 3 purchases, ₹9.8 lakh.
> Haider Supply owes ₹53,559, 12 days old — oldest of 4 unpaid invoices (₹2.1 lakh).
> 2 supplier bills due, ₹1.4 lakh. PP stock 8,075 kg. 1 blank invoice to fill.

Pure function `morningBrief(input, today): string[]` in `src/renderer/lib/dashboard.ts` (same
module as the other dashboard derivations), input drawn from data the dashboard already loads —
no new IPC. Each sentence unit-tested, including the empty states ("No unpaid invoices — all
collected." etc.). Rendered as large `Text` lines in a `Paper`, sentences clickable where they
have a natural target (unpaid → `/sales?unpaid=1`, blank invoice → `/sales`).

## 6. Big-text mode

A **Text size** setting: Normal | Large | Extra large (Settings → Business panel), stored as
`ui_scale` in the settings table (`'1'`, `'1.15'`, `'1.3'`; `DEFAULT_SETTINGS.ui_scale = '1'` —
string type keeps `getSettings`'s number-coercion rule untouched for it, matching `data_folder`
handling). `App.tsx` reads settings at boot and applies the factor via Mantine's theme `scale`
plus root `font-size` so rem-based components scale coherently. Changing the setting applies
immediately (settings save already returns the fresh settings).

## 7. Explicitly out of scope (this round)

- **WhatsApp send** (parked by owner): the two-click flow — silent `printToPDF` of the invoice +
  `wa.me/<phone>` chat with pre-typed text; attach stays manual (WhatsApp platform restriction).
  The silent-PDF generator is the reusable groundwork when this is picked up.
- New sale like this / last-rate memory / global search / day-book (offered, not selected).
- Outstanding summary and month subtotals on reports (offered, not selected).

## 8. Testing

Pure logic (report filtering/totals/months, morning-brief sentences, month-param filtering) unit
tested without React; screens tested with Testing Library + `fireEvent` and `// @vitest-environment jsdom`
(repo convention; no `user-event`). New IPC methods covered by core tests (payment set/unset,
created-only guard) and by the `api-shape` channel guard. Settings scale: reference-test for the
new default + a renderer test that the toggle calls `saveSettings` with the chosen factor.
