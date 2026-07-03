# Purchase migration — design

**Date:** 2026-07-03
**Scope:** One-time import of historical **purchases** from a spreadsheet export into a Granule Trader `.db`. Sales and stock are separate, later phases.

## Goal

Import historical purchase invoices from the owner's purchase sheet (exported to a local CSV) into the `purchases` table, preserving the sheet's own tax figures exactly, linking each lot to a supplier, and keeping each lot's item description. The importer runs locally on the owner's machine; no business data leaves the machine.

## Privacy model

The real data never needs to enter an AI context. The importer is developed and tested against **dummy data** (fake names/amounts in the real format). The owner exports the real purchase tab to a local CSV and runs the script themselves. Only column structure and redacted samples are ever shared during development.

## Source data

One row per purchase invoice. Columns (as exported; header names matched case-insensitively):

`Our Code`, `Invoice Number`, `Invoice Date`, `Party`, `Description`, `HSN Code`, `Qty`, `Amount`, `CGST`, `SGST`, `IGST`, `TCS`, `Total`, `R/Off`, `Total Invoice Amount`

Observed formats (from a dummy sample):
- `Our Code`: e.g. `082/2526` — leading digits are the sequence; `2526` is the financial-year token (FY 2025-26).
- `Invoice Date`: **`M/D/YYYY`** (US-style). `1/12/2026` = 12 January 2026.
- Amounts: plain numbers with thousands commas, e.g. `51,000.00`. `IGST`, `TCS`, `R/Off` may be blank.
- `Total` column = tax subtotal (`CGST + SGST + IGST + TCS`); not stored, used only as a cross-check.
- `Description` (e.g. `Black M/B`) is a per-lot item name; multiple products can share one HSN.

## Decisions

1. **Trust the sheet's tax numbers.** Import `CGST/SGST/IGST/TCS/R-Off/Total Invoice Amount` verbatim; do **not** recompute via `computeTax` (the app's `createPurchase` would recompute and could distort historical figures, and supplier state — which drives the intra/inter split — is not in the sheet).
2. **Per-purchase `description` field.** Add a `description` column to `purchases` to hold the item name (`Black M/B`). The shared `hsn_products.description` cannot be used because many products share one HSN.
3. **Suppliers by name only.** Create/match a supplier per distinct `Party` name; other supplier fields left blank for the owner to fill in later via the Suppliers screen.
4. **Dates `M/D/YYYY`; FY derived from the parsed date** (the app's model). A row whose code-year disagrees with its date-year is flagged for review, not silently imported.
5. **Payment status `done`** for all migrated purchases (historical = paid); `payment_date` left `null`.
6. **Derived fields:** `rate_per_kg = round2(amount / qty)`; a new HSN's `gst_rate = round((cgst+sgst+igst)/amount × 100)`.
7. **Dry-run first**, idempotent commit — see below.

## Architecture

Follows the existing `customer-import` convention: a pure helpers module (no DB) that both the CLI and vitest import, a thin CLI wrapper that does DB writes, and tests under `tests/scripts/`.

- **`scripts/purchase-import.mjs`** — pure ESM helpers, no DB access:
  - `parseCsv` — reused from the existing pattern (quoted commas, comma/tab auto-detect, CRLF, blank-line skip, leading "Table 1" title-row skip).
  - `cleanNumber(s)` — `"51,000.00"` → `51000`; blank → `0`; preserves negatives.
  - `parseDateMDY(s)` — `M/D/YYYY` → `YYYY-MM-DD`; returns `null` on an invalid/unparseable date.
  - `fyFromDate(date)` and `seqFromCode(code)` — mirror the app's `financialYear` / `parsePurchaseSeq` (comment points to the source of truth; unit-tested to agree on boundaries).
  - `mapPurchaseRows(rows) → { toImport, skipped }` — validates and maps; `skipped` entries carry `{ line, code, party, reason, raw }` (`raw` = original cells, so the skipped-rows CSV can reproduce the source columns).
  - `buildLogReport(...)` and `buildSkippedCsv(header, skipped)` — pure text builders for the two report files.
- **`scripts/import-purchases.mjs`** — thin CLI:
  - Usage: `node scripts/import-purchases.mjs <data.db> <purchases.csv> [--commit]`.
  - Dry-run by default (writes nothing). `--commit` performs the writes.
  - Opens the DB via `better-sqlite3` (already a dependency); app must be closed (releases the data lock).
- **`tests/scripts/purchase-import.test.mjs`** — vitest over the pure helpers (dummy data).

## Data mapping

| Sheet column | Target field | Transform |
|---|---|---|
| Our Code | `our_code` (verbatim), `code_seq` | `seqFromCode` = leading digits |
| Invoice Number | `supplier_invoice_number` | trim |
| Invoice Date | `invoice_date`, `fy_label` | `parseDateMDY`; `fyFromDate` |
| Party | `party` + `supplier_id` | upsert supplier by name (name only) |
| Description | `description` | trim |
| HSN Code | `hsn_code` | ensure `hsn_products` row exists |
| Qty | `qty_kg`, `qty_remaining_kg` | `cleanNumber`; `qty_remaining_kg = qty_kg` |
| Amount | `amount` | `cleanNumber` |
| CGST / SGST / IGST / TCS | `cgst` / `sgst` / `igst` / `tcs` | `cleanNumber` (blank → 0) |
| Total | — | ignored except as cross-check |
| R/Off | `roundoff` | `cleanNumber` (blank → 0; may be negative) |
| Total Invoice Amount | `total_invoice_amount` | `cleanNumber` |
| *(derived)* | `rate_per_kg` | `round2(amount / qty)` |
| *(derived)* | `payment_status` = `done`, `payment_date` = `null` | |
| *(derived)* | `hsn_products.gst_rate` (new HSN only) | `round((cgst+sgst+igst)/amount × 100)` |

`qty_remaining_kg` starts at the full quantity; the later sales-migration phase decrements it via lot allocations, consistent with how the running app maintains stock.

## Schema change

Add `description` to `purchases`:
- `schema.ts`: additive `ALTER TABLE purchases ADD COLUMN description TEXT NOT NULL DEFAULT ''`, `hasColumn`-guarded (same pattern as the existing additive block). Also add to the base `CREATE TABLE` for fresh installs.
- `types.ts`: add `description: string` to `Purchase`.
- `purchase.ts`: accept and store `description` in `createPurchase` and `updatePurchase`.
- `PurchaseForm.tsx`: add a "Description / item" text input.
- `Purchases.tsx`: show the description (new column or under the code).

*(Deferred to the sales phase: whether a sold lot's `description` becomes the invoice line text.)*

## Supplier handling

For each distinct `Party`: match an existing supplier by exact, trimmed, case-insensitive name; if none exists, create one with the name only (all other fields blank). Link the purchase's `supplier_id`; the denormalized `party` text keeps the name. New suppliers are listed in the dry-run report.

## Validation & dry-run report

Dry-run is the default and writes nothing **to the database**. For every data row it reports:

- **Summary counts:** rows read / will-insert / will-skip-duplicate / needs-attention.
- **Needs-attention** (with line numbers), for any of:
  - unparseable `Invoice Date`,
  - `Qty <= 0`,
  - blank `Our Code`, `Party`, or `HSN Code`,
  - **code-year ≠ date-year** (e.g. code `082/2526` but date resolves to FY 2026-27),
  - tax cross-check failure: `|amount + cgst + sgst + igst + tcs + roundoff − total_invoice_amount| > 1` (₹1 tolerance).
- **Suppliers to be created:** the new party names.

### Report files (logs)

The console shows only the summary. The full detail is always written to timestamped files **next to the input CSV**, on both dry-run and commit runs (so nothing scrolls away and every run is auditable):

- **`purchase-import-<timestamp>.log`** — plain-text report: run mode (dry-run / commit), the summary counts, the full needs-attention list (`line · code · party · reason`), duplicates skipped, and suppliers created/to-create.
- **`purchase-import-skipped-<timestamp>.csv`** — every skipped row reproduced with **its original columns** plus a trailing **`Skip Reason`** column. This is the actionable one: fix those rows in your sheet (or in this file), re-export, and re-run — only the previously-skipped rows will be new.

To reproduce original columns, each `skipped` entry carries the raw cells: `{ line, code, party, reason, raw }`. Building the two report texts is done by pure, unit-tested helpers (`buildLogReport`, `buildSkippedCsv`); the CLI just writes them to disk.

## Commit & idempotency

`--commit` runs all inserts in a single `better-sqlite3` transaction:
- **Dedup key `(fy_label, code_seq)`** — matches the app's purchase-code uniqueness. Lots already present are skipped, so the import is safely re-runnable.
- Rows flagged in needs-attention for a hard reason (bad date, non-positive qty, blank required field, **code-year ≠ date-year**) are skipped and re-listed for the owner to fix in the sheet; valid rows insert. The tax cross-check is a **warning only** — it is reported but does not block insert, since the sheet's figures are trusted.
- Prints final inserted / skipped-duplicate / skipped-invalid counts, and writes the same `purchase-import-<timestamp>.log` and `purchase-import-skipped-<timestamp>.csv` report files as dry-run. Any thrown error rolls back the whole batch.

## Testing

vitest over the pure helpers (dummy data only):
- `cleanNumber`: thousands commas, blanks → 0, negatives.
- `parseDateMDY`: valid, invalid, and `1/12/2026` → `2026-01-12`.
- `fyFromDate` / `seqFromCode`: agree with the app on FY boundaries (`2025-04-01` → 2025-26, `2026-03-31` → 2025-26, `2026-04-01` → 2026-27) and `082/2526` → `82`.
- tax cross-check tolerance.
- code/date-year mismatch flagging.
- `mapPurchaseRows`: end-to-end over a dummy CSV (valid rows mapped, bad rows skipped with reasons and their raw cells retained).
- `buildSkippedCsv`: skipped rows reproduce their original columns plus the `Skip Reason` column; `buildLogReport`: contains the summary and every skip reason.
- DB-insert path exercised against a `:memory:` DB (supplier upsert dedup, `(fy_label, code_seq)` dedup, HSN ensured).

## Out of scope

- Sales and stock migration (separate phases).
- Backfilling supplier details (owner does this later in-app).
- Invoice line-text sourcing from `description` (a sales-phase decision).
