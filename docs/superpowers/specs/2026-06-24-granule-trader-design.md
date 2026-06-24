# Granule Trader — Design Spec

**Date:** 2026-06-24
**Status:** Draft for review

## 1. Purpose

A cross-platform desktop application to replace the Excel workflow of a plastic
granules trading business. It manages purchases, sales, customers, and stock,
and produces printable/PDF GST invoices. The primary user is the owner (a senior
citizen who is not tech-savvy), so the interface must be large, light, and
simple.

## 2. Goals and non-goals

**Goals (v1):**
- Record purchases (with GST tax fields and payment status) — each purchase becomes a stock lot.
- Record sales that draw quantity from one or more purchase lots, with per-lot pricing.
- Maintain a customer database that auto-fills the buyer on a sale.
- Track stock as a live ledger derived from purchases and sales.
- Generate a printable / PDF GST invoice from a sale (layout matches the owner's existing invoice — sample to be provided).

**Non-goals (v1):** in-app Excel import (handled once by a separate local script),
monthly report exports, multi-user concurrent editing, cloud sync, GST e-filing.
See Future Scope.

## 3. Platform and technology

- **Electron + React + TypeScript.** Runs identically on macOS and Windows. The
  bundled Chromium makes pixel-accurate invoice rendering and native printing
  straightforward (the invoice is an HTML/CSS template "printed to PDF").
- **SQLite**, a single `.db` file, accessed only from Electron's main process
  via `better-sqlite3`.
- **Architecture in three layers:**
  - **UI (renderer, React/TS)** — the screens; never touches the database directly.
  - **Core logic (main process, plain TS)** — tax, numbering, stock draw-down,
    backups, PDF. Fully unit-testable without UI. Exposed to the UI via typed IPC
    functions (e.g. `createSale`, `listAvailableLots`, `createPurchase`).
  - **Storage (SQLite)** — schema + queries, owned by the core layer.

## 4. Data storage, locking, and backups

The database file lives in a folder the user picks on first launch (typically a
Dropbox/Google Drive/iCloud folder so a second machine can use it). Cloud-synced
SQLite is safe **only when one machine has it open at a time**, so:

- **Lock file:** on open, the app writes a lock file (machine name + timestamp)
  beside the database. If a lock already exists, it warns: *"This data is
  currently open on [machine]. Open anyway only if you're sure it's closed
  there."* The lock is removed on clean exit.
- **Automatic backups:** on every launch, a timestamped copy of the database is
  written to a `backups/` subfolder; the last N copies are kept (configurable,
  default 10). A manual **"Backup now"** button is also available.
- **Sync-safe settings:** rollback journal mode (not WAL), connection closed
  cleanly on exit, so the cloud service syncs a single consistent file.

## 5. Data model

Amounts are stored in rupees with 2-decimal precision. Quantities are in kg.

### 5.1 `purchases`
| Field | Notes |
|---|---|
| id | primary key |
| our_code | format `NNNN/YYYY` (e.g. `0022/2425`), auto-generated per financial year, **editable** |
| supplier_invoice_number | the supplier's actual invoice number |
| invoice_date | |
| party | supplier name |
| party_state | drives intra/inter-state tax for the purchase |
| hsn_code | |
| qty_kg | quantity purchased |
| qty_remaining_kg | starts equal to `qty_kg`; drawn down by sales/adjustments → **drives stock** |
| amount | taxable amount, excluding GST |
| cgst, sgst | computed (9% each by default), stored |
| igst | optional |
| tcs | optional |
| roundoff | manual |
| total_invoice_amount | amount + taxes + tcs + roundoff |
| payment_status | `pending` / `done` |
| payment_date | set when marked done |
| created_at | |

### 5.2 `customers`
| Field | Notes |
|---|---|
| id | primary key |
| name | |
| gstin | |
| pan | |
| phone | optional |
| billing_address, billing_city, billing_state, billing_pincode | |
| shipping_same | boolean; when true, shipping = billing |
| shipping_address, shipping_city, shipping_state, shipping_pincode | used only when `shipping_same` is false |

**Place of supply** (for tax) = shipping state, falling back to billing state when
shipping = same.

### 5.3 `sales`
| Field | Notes |
|---|---|
| id | primary key |
| invoice_number | format e.g. `RP/008/2024-25`, **editable**, sequential within financial year |
| status | `reserved` (placeholder, blank) / `created` (real bill) |
| invoice_date | |
| eway_bill_no, eway_bill_date | optional |
| vehicle | "By Taxi" / "By Van" / free-text vehicle number |
| buyer_customer_id | link to `customers` |
| buyer details snapshot | name, gstin, addresses copied at time of sale (so later edits to the customer don't rewrite history) |
| hsn_code | |
| amount | taxable amount = **sum of allocation line amounts** |
| cgst, sgst, igst | computed from place of supply |
| tcs, roundoff | optional/manual |
| total_invoice_amount | amount + taxes + tcs + roundoff |
| total_qty_kg | sum of allocation quantities |
| payment_status, payment_date | |
| created_at | |

### 5.4 `sale_allocations`  (the link that makes stock work)
| Field | Notes |
|---|---|
| id | primary key |
| sale_id | link to `sales` |
| purchase_id | the lot drawn from |
| qty_drawn_kg | quantity taken from this lot |
| rate_per_kg | **per-lot selling price** |
| line_amount | qty_drawn_kg × rate_per_kg |

A sale has one or more allocation rows (one per lot). All rows of a sale share the
same HSN.

### 5.5 `stock_adjustments`
| Field | Notes |
|---|---|
| id | primary key |
| purchase_id | the lot adjusted |
| qty_kg | amount removed |
| reason | e.g. spillage, sample, loss, correction |
| date | |
| created_at | |

Adjustments draw down `qty_remaining_kg` like a sale but produce no invoice.

### 5.6 `hsn_products`
| Field | Notes |
|---|---|
| hsn_code | |
| description | e.g. "Polypropylene" |
| gst_rate | default 18% (used to split 9/9 or apply 18% IGST) |

### 5.7 `settings`
Seller name, address, GSTIN, PAN, **home state** (for the tax decision), sales
invoice prefix and format, purchase code format, default GST rate, data folder
path, low-stock threshold, number of backups to keep.

## 6. Core business rules

### 6.1 Tax calculation
- Place of supply = buyer's shipping state (fallback billing). If it equals the
  seller's home state → **CGST + SGST** (9% each by default). Otherwise → **IGST**
  (18%). Never both.
- Rate comes from the HSN (`hsn_products.gst_rate`, default 18%), so a granule with
  a different rate is handled correctly.
- `TCS` and `R/Off` are optional manual fields.
- `Total = amount + cgst + sgst + igst + tcs + roundoff`, rounded to 2 decimals.

### 6.2 Per-lot pricing (sales)
Each lot drawn in a sale carries its own `rate_per_kg`; the line amount is
`qty × rate`. The sale's taxable amount is the **sum of all line amounts**, and tax
is computed on that sum.

### 6.3 Stock draw-down (atomic)
On saving a sale: in a **single database transaction**, create the sale, insert one
`sale_allocations` row per lot, and reduce each lot's `qty_remaining_kg`. If
anything fails, nothing is saved. The app:
- prevents drawing more than a lot's available quantity, and
- requires total drawn = quantity needed before saving (live "✓ Allocated X / Y kg").

### 6.4 Available-lots query (date-aware)
When building a sale dated D, the app offers only lots whose **purchase date ≤ D**.
For backdated bills it offers each lot's quantity **still unsold as of D** — i.e.
quantity already consumed by sales/adjustments dated on or before D is subtracted
first — so a past-dated sale cannot take stock that was already gone.

### 6.5 Purchase code numbering
`our_code` auto-suggests the next `NNNN/YYYY` for the current financial year
(April–March), is **editable**, and resets each financial year.

### 6.6 Sales invoice numbering, reservation, and order validation
- Auto-suggests the next number in the current financial year (e.g. `RP/009/2024-25`),
  but the user may **edit it** — e.g. jump to `RP/011` and create the bill there.
- **Gap reservation:** skipped numbers (`RP/009`, `RP/010`) become **reserved
  placeholder rows** — shown blank in the Sales register with a **Fill** action for
  later.
- **Monotonic date↔number validation:** invoice numbers and invoice dates must stay
  jointly ordered. When a number is created or a reserved one filled, its date must
  be **≥ the date of the nearest earlier-numbered bill** and **≤ the date of the
  nearest later-numbered bill**. Violations are blocked with a clear message
  (e.g. *"Date must be on or before 24/06/2026 to keep invoice order valid"*).

### 6.7 Stock as derived data
There is no stored "stock" number. Stock on hand = purchases with
`qty_remaining_kg > 0`; the Stock screen renders these as a per-lot ledger with a
running balance, mirroring the owner's existing Excel "Stock Statement". Editing or
deleting a purchase or sale auto-corrects stock.

## 7. Screens

A left sidebar navigates: **Dashboard, Purchases, Sales, Stock, Customers, Settings.**

- **Dashboard** — greeting + date, large "New sale" / "New purchase" buttons, KPI
  cards (sales this month, stock on hand, payments pending), and attention lists
  (pending payments, low stock).
- **Purchases** — list + entry form (Section 5.1 fields), live tax summary, payment
  toggle. Saving adds a lot to stock.
- **Sales** — register (with reserved blank rows + Fill) and the New Sale flow:
  buyer (auto-filled from GSTIN/name), editable invoice number, date, optional
  fields (e-way bill no./date, vehicle, TCS, round-off), HSN, date-filtered lot
  allocation table with per-lot draw + rate + amount, live tax summary, and
  "Save sale & draw stock" / "Save & generate invoice PDF".
- **Stock** — HSN-grouped, per-lot ledger with running Balance column; "New sale
  from stock" and "Stock adjustment" actions.
- **Customers** — searchable list + add/edit form (Section 5.2 fields) with the
  "Shipping same as billing" toggle.
- **Settings** — seller details + home state, invoice/code formats, data folder,
  default GST rate, low-stock threshold, backup count, "Backup now".

### 7.1 UI/UX principles (senior-friendly)
- Large base font (~18px; headings to 30px), generous spacing, big buttons.
- Light theme; **explicit white backgrounds and dark text on all inputs** so the
  app does not inherit the OS dark mode and render fields as black boxes.
- Minimal jargon; keyboard-friendly data entry; clear, specific error messages.

## 8. Invoice PDF

The invoice is an **HTML/CSS template** rendered by the bundled Chromium to PDF and
to the native print dialog. The template is **swappable** so it can be matched to
the owner's existing invoice layout once a sample (with dummy data) is provided. It
will include the standard GST tax-invoice fields: seller and buyer details + GSTINs,
invoice number/date, HSN, taxable value, CGST/SGST/IGST, TCS, round-off, totals,
amount in words, and e-way bill / vehicle when present.

## 9. Error handling and testing

- **Atomic transactions** for any operation that changes stock; all-or-nothing.
- **Validation** with friendly, specific messages (e.g. *"Lot 0014/2425 only has
  1,200 kg left"*).
- **Unit tests** for the core logic: tax calculation, purchase-code and
  invoice-number generation, gap reservation, monotonic date↔number validation,
  available-lots (date-aware, as-of-date remaining), stock draw-down atomicity and
  over-draw prevention, and backup creation.
- **Integration test** for the end-to-end "create sale → stock decremented →
  invoice generated" flow.

## 10. One-time data migration

Historical data is imported **once** via a separate local script the user runs on
their own machine (not an in-app feature). It reads the existing Excel sheets and
populates the database. All real data stays local; no real business data is shared
in conversation.

## 11. Future scope (not in v1)

- **Download monthly sales & purchase reports** (e.g. Excel/PDF for the accountant
  and GST filing).
- In-app Excel import.
- GST return-ready exports (GSTR-1 style).
- Cloud backup and/or multi-user concurrent access.

## 12. Open items to finalize

- Exact invoice PDF layout — awaiting the owner's sample (dummy data).
- Seller settings values (name, GSTIN, home state, invoice prefix).
- Low-stock threshold default.
