# Granule Trader — Refinement 2 Design

**Date:** 2026-07-11
**Status:** Approved, ready for planning

## Purpose

Seven requirements raised after the owner used the app against real imported data (40 purchases,
6 HSN codes, Jan–Jun 2026). They are not independent: one of them changes the data model that the
others build on, so this spec locks the decisions and fixes the order.

## Decisions

| Question | Decision |
|---|---|
| Multiple HSN per purchase | **Yes** — a purchase holds line items; **each line is its own stock lot**. Tax totals stay at invoice level. |
| Low stock means | **Total remaining kg per material (HSN) below the threshold** — a re-order signal, not a per-lot one. |
| Editing a sale | **Full edit** — buyer, date, lots, quantities, rates. Old stock draw is returned, new one taken. Invoice number is fixed. |
| Receivables/payables drill-down | **Filter the existing Sales/Purchases screens** (unpaid, oldest first). No new screens. |
| Invoice output | **Unchanged.** No requirement here alters what the customer sees, except the Phase 0 spacing fix. |

## Sequencing (and why)

Today **a purchase row *is* a stock lot**: `purchases` carries one `hsn_code` / `qty_kg` /
`qty_remaining_kg`, and `sale_allocations.purchase_id` points at it. Multi-HSN breaks that
one-to-one — a "lot" becomes a purchase *item*. Every downstream feature that touches lots
(the lot picker, sale editing, the stock ledger, the dashboard) must therefore come **after** it,
or it gets built twice.

0. **Invoice PDF spacing** — small, independent, already broken. Quick win first.
1. **Multi-HSN purchases** — the foundation.
2. **Lot picker redesign** (+ drop supplier from the sale screen) — needs #1.
3. **Edit a sale** — needs #1's tables and the re-draw logic.
4. **Dashboard, receivables/payables, low stock** — pure view layer, safest last.

---

## Phase 0 — Invoice PDF spacing

**Symptom:** on a multi-HSN sale preview, the first line item leaves too much vertical space.
**Scope:** `src/renderer/invoice/InvoiceTemplate.tsx` + `invoice.css` only. The printed layout must
otherwise stay pixel-identical — it was matched to the owner's existing invoice in a prior spec
(`2026-06-26-invoice-template-exact-match-design.md`), so this is a targeted spacing fix, not a redesign.
**Approach:** diagnose with systematic-debugging before changing anything; the cause must be identified,
not guessed at.

---

## Phase 1 — Multi-HSN purchases

### Data model

New table, one row per purchase line; **this row is the stock lot**:

```sql
CREATE TABLE purchase_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  hsn_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  qty_kg REAL NOT NULL,
  qty_remaining_kg REAL NOT NULL,
  rate_per_kg REAL NOT NULL DEFAULT 0,
  amount REAL NOT NULL DEFAULT 0,
  gst_rate REAL NOT NULL DEFAULT 0,
  line_no INTEGER NOT NULL DEFAULT 1
);
```

`sale_allocations` gains `purchase_item_id INTEGER REFERENCES purchase_items(id)`. It keeps
`purchase_id` (the parent) so existing invoice rendering and reports keep working unchanged.

Invoice-level fields stay on `purchases`: `our_code`, dates, party/supplier, `cgst/sgst/igst/tcs/
roundoff/total_invoice_amount`, `payment_status`, `fy_label`, `code_seq`.

The per-line columns on `purchases` (`hsn_code`, `qty_kg`, `qty_remaining_kg`, `rate_per_kg`,
`amount`, `description`) are **retained and left in place**, not dropped. Dropping them would
require rebuilding the table and would break the CSV importer and any report reading them.
They are backfilled to mirror line 1 for single-line purchases and are no longer the source of
truth for stock. New code reads lots from `purchase_items`.

### Migration (schema_version 2, gated like version 1)

For every existing purchase, insert exactly one `purchase_items` row copying its HSN, description,
qty, remaining, rate, and amount, with `line_no = 1`. Then set `sale_allocations.purchase_item_id`
to that purchase's single item. This is safe because today every purchase has exactly one line.
Idempotent, and gated on `schema_version < 2` so it runs once.

### Code changes

- `src/main/core/purchase.ts` — `NewPurchase` takes `items: NewPurchaseItem[]`; create/update write
  the parent plus its items in one transaction; tax computed across all lines (grouped by HSN+rate,
  reusing the `computeSaleTax` grouping approach); delete cascades.
- `src/main/core/available-lots.ts` — a lot is a `purchase_item`; `AvailableLot` gains
  `purchase_item_id` and keeps `our_code` (now shown as `0041/2526-2` for line 2).
- `src/main/core/sale.ts` — allocations draw from `purchase_items.qty_remaining_kg`.
- `src/main/core/adjustment.ts` — stock ledger and adjustments key on `purchase_item_id`.
- `src/renderer/screens/PurchaseForm.tsx` — repeating line rows (add/remove), tax summary across lines.
- `scripts/import-purchases.mjs` — writes one item per imported row.

### Guard

A purchase must have at least one line. Deleting a purchase whose items have been sold is already
guarded and stays guarded.

---

## Phase 2 — Lot picker redesign

Replaces the exhaustive checkbox table on New Sale, which today renders **every** unexhausted lot
(40 today, growing ~80/year) with a checkbox each.

Two panels:

1. **Add stock to this sale** — material (HSN) filter, a search box matching lot code, a fixed-height
   scrolling list of matching lots **oldest first** showing code · date · age · available kg · cost/kg
   with an **Add** button, and a count line ("23 lots · 90,500 kg available"). Plus **Fill oldest first**:
   choose a material, type a quantity, and lots are added oldest-first until it is met; a shortfall is
   stated in plain English.
2. **Selling from these lots** — only the chosen lots, each with sell rate, quantity, amount, and a
   remove button, with a running total. This panel is 1–3 rows regardless of how many lots exist.

**Supplier is removed** from the sale screen entirely — it is not needed when selling.

New component `src/renderer/components/LotPicker.tsx` (NewSale.tsx is already 254 lines).
Two pure functions in `src/renderer/lib/allocation.ts`, unit-tested with no React:

- `filterLots(lots, { hsn, query })` — narrow by material; case-insensitive match on lot code.
- `fifoFill(lots, hsn, qtyKg)` → `{ draws, shortfall }` — oldest-first, never exceeding a lot's available.

The payload sent to `createSale` is unchanged, so **the printed invoice is unchanged**.

---

## Phase 3 — Edit a sale

`updateSale(db, id, input)` in `src/main/core/sale.ts`, in one transaction:

1. Return every existing allocation's quantity to its `purchase_item`.
2. Re-run the full `writeSale` validation (stock availability, invoice ordering, e-way bill threshold
   is a form gate and stays one) against the new lines.
3. Write the new allocations and re-draw the stock.

The invoice number, prefix, seq, and financial year are **fixed** — editing cannot renumber an issued
invoice. If validation fails, the transaction rolls back and the original draw is intact.

Sales list gains an Edit action routing to `/sales/edit/:id`, reusing the NewSale screen in edit mode
(it already supports a `fill` mode, so this is a third mode on the same screen).

---

## Phase 4 — Dashboard, receivables/payables, low stock

The dashboard today stacks four KPIs, an Action Center listing every overdue invoice, two charts, an
aging chart, and an inventory aging table. It is cramped and lists detail that belongs on a list screen.

**New shape:**

- **Top row (4 tiles, all clickable):** Sales · FY → `/sales`; Purchases · FY → `/purchases`;
  Receivables outstanding (to date) → `/sales?unpaid=1`; Payables outstanding (to date) →
  `/purchases?unpaid=1`.
- **Second row:** Stock on hand → `/stock`; Net GST payable · FY.
- **Action Center:** keep, but show **counts with a link**, not a full invoice list — e.g.
  "6 invoices overdue · view", "3 materials low · view". No invoice-by-invoice dump.
- **Charts:** keep the sales/purchase trend and the stock donut. Drop the separate aging chart and the
  inventory aging table from the dashboard — that detail lives on Stock.

**Receivables/payables drill-down:** Sales and Purchases screens accept an `unpaid` query param that
filters to `payment_status = 'pending'` and sorts oldest first. No new screens.

**Low stock, redefined:** `lowStock` currently flags any *lot* under the threshold, so a 400 kg lot
warns even when 90,000 kg of that material sits in 22 other lots. It becomes: sum remaining kg per
HSN, warn when the **material total** is below `low_stock_threshold`. Returns one row per material,
not per lot.

## Testing

Every phase is TDD, following the existing split: pure logic in `src/**/core` and `src/renderer/lib`
gets unit tests; components get Testing Library tests with `fireEvent` (this repo does not use
`user-event`); renderer tests need the `// @vitest-environment jsdom` pragma. `tests/core/api-shape.test.ts`
must list any new IPC method. Phase 1 additionally needs a migration test proving the 40 existing
single-line purchases become 40 one-item purchases with their allocations repointed.
