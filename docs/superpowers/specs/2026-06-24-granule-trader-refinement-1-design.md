# Granule Trader — Refinement Round 1 Design Spec

**Date:** 2026-06-24
**Status:** Draft for review
**Builds on:** `2026-06-24-granule-trader-design.md` (v1, already implemented)

## 1. Purpose

Refine the shipped v1 app for real use by the owner: a complete mandatory
onboarding profile, list/form separation on every screen, customer validation
with pincode-driven location, clearer live GST display, a multi-HSN sale flow,
and a dedicated, well-explained stock-adjustment screen.

## 2. Scope

In scope: onboarding profile + invoice-prefix auto-derivation; route-based
list/form separation (Purchases, Customers, Stock-adjust); customer validation +
Indian-state dropdown + offline pincode auto-fill; live three-box GST display
with negative round-off and payment-date capture; multi-HSN sale with per-line
tax; dedicated stock-adjustment screen with guidance and undo.

Out of scope: packaging/installer, monthly reports, Excel import (still the
standalone stub), cloud sync.

## 3. Decisions locked in this round

- **Location input:** offline pincode → city/state, via an npm offline lookup
  package; fallback is a bundled compact pincode→{city,state} JSON. State is also
  a dropdown of Indian states/UTs.
- **List/form layout:** separate pages via routes (not modals/drawers).
- **Inter-state:** handled. Place of supply decides intra (CGST 9% + SGST 9%,
  IGST 0%) vs inter (IGST 18%, CGST/SGST 0%); all three boxes always shown.
- **Validation:** required **and** format checks (GSTIN, PAN, mobile, pincode).
- **Sale HSN:** a sale may span multiple HSNs; HSN lives per allocation line; tax
  is computed per HSN rate-group then summed.

## 4. Data-model changes

### 4.1 `sale_allocations` — add per-line HSN + rate snapshot
| Field | Change |
|---|---|
| hsn_code | **new** — copied from the drawn lot's purchase at sale time |
| gst_rate | **new** — snapshot of the HSN's GST rate at sale time (so later rate edits don't rewrite history) |

### 4.2 `sales` — drop the single HSN
- Remove `hsn_code` from `sales` (and from the `Sale` type and all reads/writes).
  HSN is now per allocation line. The sale's `cgst`/`sgst`/`igst`/`amount`/
  `total_invoice_amount`/`total_qty_kg` remain as the summed totals.

### 4.3 `settings` — add seller mobile
- New key `seller_phone` (string). Added to `Settings` type and `DEFAULT_SETTINGS`.

No migration needed: the database has no real data yet. The schema's
`CREATE TABLE IF NOT EXISTS` is updated; for a clean rebuild the dev `.db` in the
data folder is recreated. (If a stale dev `.db` exists, it is safe to delete it —
no business data.)

## 5. Onboarding (FirstRun)

A single setup page collecting the full seller profile. **All required:**

| Field | Rule |
|---|---|
| Business name | non-empty |
| GSTIN | 15-char GSTIN pattern `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$` |
| PAN | 10-char pattern `^[A-Z]{5}[0-9]{4}[A-Z]$` |
| Mobile | 10 digits `^[0-9]{10}$` |
| Address | non-empty |
| Home state | dropdown of Indian states/UTs (non-empty) |
| Data folder | chosen via the folder picker |
| Invoice prefix | **auto-derived** from business-name initials, editable |

**Prefix derivation:** uppercase first letter of each word in the business name,
skipping words ≤2 chars that are common joiners (`and`, `the`, `of`, `&`).
"Ramaxton Plastocrafts" → `RP`; "Shree Ram Traders" → `SRT`. Falls back to the
first two letters if only one word. The user may overwrite it.

The "Start using Granule Trader" button is disabled until every field is valid;
invalid fields show a specific message (e.g. *"GSTIN must be 15 characters like
24ABCDE1234F1Z5"*). On submit, all fields persist to settings (including
`seller_phone`, `invoice_prefix`, `home_state`).

## 6. List ⇄ form separation

Each entity screen splits into a **list page** (table + "Add" button + per-row
Edit/Delete) and a **dedicated form page**:

| Screen | Routes |
|---|---|
| Purchases | `/purchases` (list), `/purchases/new`, `/purchases/edit/:id` |
| Customers | `/customers` (list), `/customers/new`, `/customers/edit/:id` |
| Sales | `/sales` (list), `/sales/new`, `/sales/fill/:id` *(already split)* |
| Stock | `/stock` (ledger), `/stock/adjust` (adjustment screen — §9) |

**Sales register row actions:** each **created** sale row gets a **"Preview / PDF"**
action that opens its invoice at `/invoice/:id` (the existing InvoiceView, with
Print / Save-as-PDF). This lets the owner re-open and print any past sale's
invoice at any time, not only at creation. Reserved (blank) rows show **Fill**
instead (no invoice exists yet).

A shared `FormPage` layout (title, error banner, body, Save/Cancel) keeps the
form pages consistent. The list pages keep search/filter where they already have
it. Edit pages load the record by `:id`; Save routes back to the list.

## 7. Customer form — validation + location

- **State:** `StateSelect` dropdown sourced from a shared `INDIAN_STATES` list
  (28 states + 8 UTs). Used for billing and shipping state, and for the seller
  home state in onboarding/settings.
- **Pincode:** `PincodeField` — on a valid 6-digit entry, looks up city + state
  offline and auto-fills them (both remain editable). Lookup is a pure function
  `lookupPincode(pin): { city: string; state: string } | null` backed by the
  offline dataset/package.
- **Mandatory:** name; GSTIN (15-char); billing address, city, state, pincode
  (6-digit). **Validated if present:** PAN (10-char), phone (10-digit). Shipping
  fields required only when "Shipping same as billing" is unchecked.
- Inline, specific validation messages; Save disabled until valid.

## 8. GST display (Purchases form + Sales form)

A shared, read-only **tax summary** component shows three labelled boxes with
live ₹ values, driven by place of supply vs home state:

- **Intra-state:** `CGST 9% = ₹x`, `SGST 9% = ₹x`, `IGST 0% = ₹0`.
- **Inter-state:** `CGST 0% = ₹0`, `SGST 0% = ₹0`, `IGST 18% = ₹x`.

Values recompute as the taxable amount changes. Each rate label shows the
percentage so the figure is never ambiguous. **Round-off** uses a
`SignedMoneyInput` that accepts an optional leading `−` (e.g. `−0.40`); it feeds
the existing `roundoff` field, which already flows into the total. When
**payment status = Done**, a **payment-date** input appears (defaults to today)
and is saved to `payment_date`; when Pending it is hidden/cleared.

Purchases keep a single HSN (a lot is one product); the purchase form's tax uses
that HSN's rate via the existing `computeTax`.

## 9. Stock Adjustment — dedicated screen (`/stock/adjust`)

Reached by an **"Adjust stock"** button on the Stock ledger. Contents:

- **Guidance panel** (plain language): *"A stock adjustment records granules that
  left your stock **without a sale**, so your stock figures stay correct. Use it
  for: Spillage/wastage · Sample given · Loss/damage · Correction (fix a counting
  mistake)."*
- **Disclaimer box** (highlighted): *"This permanently reduces the selected lot's
  remaining quantity. It does not create an invoice, does not involve a customer,
  and has no GST effect — it is not a sale. You cannot remove more than the lot's
  available balance."*
- **Form:** lot dropdown (shows each lot's code + remaining balance), quantity to
  remove (must be > 0 and ≤ balance), date (default today), reason (free text or
  a quick-pick of the four use cases). Specific error on over-removal.
- **Recent adjustments list:** the latest adjustments (lot, qty, reason, date)
  with a **Delete (undo)** action that restores that quantity to the lot — the
  safe way to reverse a mistaken adjustment. Delete runs in a transaction
  (re-add qty to `qty_remaining_kg`, remove the adjustment row).

New core: `listAdjustments(db, limit?)` and `deleteAdjustment(db, id)`
(transactional restore). Exposed via IPC.

## 10. Core business rules

### 10.1 Multi-HSN sale tax (`computeSaleTax`)
Given allocation lines (each with `qty`, `rate`, `hsn_code`, `gst_rate`), a
`placeOfSupplyState`, and `homeState`:
1. `line_amount = round2(qty × rate)`; `taxable = round2(Σ line_amount)`.
2. Group lines by `gst_rate`. For each group with summed amount `A` and rate `r`:
   - intra-state → `cgst += round2(A·r/2/100)`, `sgst += round2(A·r/2/100)`
   - inter-state → `igst += round2(A·r/100)`
3. `total = round2(taxable + cgst + sgst + igst + roundoff)` (no TCS in sales).
Returns `{ taxable, cgst, sgst, igst, roundoff, total, totalQty }`.

`createSale`/`fillReservedSale` (Task 10 of v1) change to: take lines carrying
`hsn_code`+`gst_rate` (resolved from each lot at selection time), store them on
`sale_allocations`, compute totals via `computeSaleTax`, and drop the sale-level
HSN. Atomicity, over-draw checks, date-aware availability, gap reservation, and
delete-restore are unchanged. TCS is removed from the sale path; round-off stays
and may be negative.

### 10.2 Invoice (per-line HSN)
The printable invoice lists each allocation as a line with its own HSN, qty,
rate, amount, and adds an **HSN-wise tax summary** (taxable, CGST/SGST or IGST
per HSN) plus the grand total — the standard GST tax-invoice layout. Reads
allocations (now carrying `hsn_code`/`gst_rate`); no longer reads a sale-level
HSN.

## 11. Shared components / modules

- `src/renderer/lib/indian-states.ts` — `INDIAN_STATES: string[]`.
- `src/renderer/components/StateSelect.tsx` — state dropdown.
- `src/renderer/components/PincodeField.tsx` — pincode input that calls the
  lookup and reports `{ city, state }` to the parent.
- `src/renderer/components/SignedMoneyInput.tsx` — numeric input allowing a
  leading `−` (for round-off); existing `MoneyInput` stays for non-negative.
- `src/renderer/components/FormPage.tsx` — shared form-page shell.
- `src/main/core/pincode.ts` — `lookupPincode(pin)` over the offline source.
- `src/main/core/validation.ts` — pure validators (`isGstin`, `isPan`,
  `isMobile`, `isPincode`, `deriveInvoicePrefix`) shared by UI and tested.
- `src/main/core/sale-tax.ts` — `computeSaleTax(...)`.

## 12. Error handling & testing

- Pure functions get unit tests: validators (`isGstin`/`isPan`/`isMobile`/
  `isPincode`/`deriveInvoicePrefix`), `computeSaleTax` (single-rate, mixed-rate,
  intra vs inter, round-off incl. negative), `lookupPincode` (hit/miss),
  `deleteAdjustment` restore, multi-HSN `createSale` (per-line HSN stored, totals
  summed across rates), and the updated invoice template (per-line HSN + HSN-wise
  summary, intra and inter).
- Atomic transactions unchanged for any stock-mutating path (sale, adjustment,
  adjustment-undo).
- Friendly, specific validation messages throughout.

## 13. Open items

- Exact pincode data source: prefer a maintained offline npm package; if none is
  suitable, bundle a compact `pincode→{city,state}` JSON generated from public
  India Post open data. Decided at implementation, with the offline guarantee
  fixed.
- Invoice layout still awaits the owner's real sample (template remains swappable;
  this round only changes its line/HSN structure).
