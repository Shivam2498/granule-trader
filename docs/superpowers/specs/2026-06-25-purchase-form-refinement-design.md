# Granule Trader — Purchase Form Refinement Design Spec

**Date:** 2026-06-25
**Status:** Draft for review
**Builds on:** v1 + refinement round 1 (`2026-06-24-*`)

## 1. Purpose

Fix three problems with the purchase entry form: the taxable amount is not
reactive to quantity (no rate), the supplier "address" is only a state dropdown,
and validation is weak (most fields not mandatory, no inline errors). After this
round the purchase form matches the customer form's quality: rate-driven reactive
amounts, a structured pincode-driven supplier address, and per-field validation.

## 2. Decisions (locked)

- **Amount = Quantity × Rate/kg.** Add a Rate per kg input; the taxable amount is
  computed (read-only) as `qty × rate`, authoritatively in the core; tax is fully
  reactive.
- **Structured supplier address:** Pincode → auto City + State (offline lookup) +
  an editable street-address line. State drives intra/inter GST.
- **Mandatory fields (inline errors, Save disabled until valid):** our code,
  invoice date, supplier name, supplier state, HSN, quantity (> 0), rate (> 0).
  Optional: supplier invoice no., city, pincode, street address, round-off, TCS,
  payment date (shown only when payment = Done).

## 3. Data model changes (`purchases`)

Add columns (idempotent `ALTER TABLE ADD COLUMN` migration, like the
`sale_allocations` migration in the previous round; guarded by `PRAGMA
table_info`):

| Column | Type | Notes |
|---|---|---|
| rate_per_kg | REAL NOT NULL DEFAULT 0 | purchase rate per kg |
| party_city | TEXT NOT NULL DEFAULT '' | supplier city |
| party_pincode | TEXT NOT NULL DEFAULT '' | supplier pincode |
| party_address | TEXT NOT NULL DEFAULT '' | supplier street address |

`amount` stays (taxable value) but is now **derived**: `amount = round2(qty_kg ×
rate_per_kg)`, computed in `createPurchase`/`updatePurchase` — the UI's amount is
display-only and never trusted. `qty_remaining_kg` and the rest are unchanged.

**Types:** `Purchase` gains `rate_per_kg`, `party_city`, `party_pincode`,
`party_address`. `NewPurchase` gains `rate_per_kg`, `party_city`,
`party_pincode`, `party_address` and **drops `amount`** as an input (the core
computes it from qty × rate). `igst_manual`/`tcs`/`roundoff`/payment fields
unchanged.

**Legacy rows:** existing purchases have `amount` set and `rate_per_kg = 0` after
migration. They display correctly (the list shows `total_invoice_amount`). When
such a row is **edited**, the form back-derives a display rate of
`amount ÷ qty_kg` (when qty > 0) so the value is preserved; saving then re-stores
`amount = qty × that rate`.

## 4. Core logic (`src/main/core/purchase.ts`)

`createPurchase(db, input: NewPurchase)`:
- `amount = round2(input.qty_kg * input.rate_per_kg)`.
- Tax via `computeTax({ amount, gstRate: input.gst_rate, placeOfSupplyState:
  input.party_state, homeState: input.homeState, tcs, roundoff })` (unchanged
  call shape, just the computed `amount`).
- Store `rate_per_kg`, `party_city`, `party_pincode`, `party_address` plus the
  existing columns.

`updatePurchase` mirrors this (and keeps the existing
"qty can't go below consumed" guard).

`nextPurchaseCode`, `listPurchases`, `getPurchase`, `deletePurchase` unchanged.

## 5. Purchase form (`src/renderer/screens/PurchaseForm.tsx`)

- **Amounts section:** Quantity (kg), Rate per kg → **Taxable amount** rendered
  read-only as `formatINR(qty × rate)`; Round off (`SignedMoneyInput`), TCS,
  Payment (+ date when Done). The live `TaxSummary` (CGST/SGST/IGST/TCS/Net)
  recomputes from `computeTax` on the derived amount — reactive to quantity and
  rate.
- **Supplier section:** Supplier name; **Pincode** (`PincodeField`, auto-fills
  City + State); **City**; **State** (`StateSelect`); **Street address** (text).
- **Validation:** an `errs` map + `valid` gate identical in spirit to
  `CustomerForm` — each mandatory field shows an inline error and Save is disabled
  until all valid. Mandatory set per §2. Amount/rate validity = `rate > 0` and
  `qty > 0`.
- **Edit:** loads the record; `rate_per_kg` falls back to `amount ÷ qty_kg` when
  the stored rate is 0 (legacy). The `!editId` auto-code guard stays.
- Payload sends `rate_per_kg` (not `amount`) + the address fields; the core
  derives and stores `amount`.

## 6. Out of scope / unaffected

Purchases list, Sales, New Sale (cost/kg already = `amount ÷ qty` = the rate),
Stock, invoice, onboarding, customers — no changes. No change to stock
draw-down, available-lots, or tax modules.

## 7. Testing

- Core unit tests (extend `tests/core/purchase.test.ts`): `createPurchase`
  computes `amount = qty × rate` and stores `rate_per_kg` + address fields; tax
  computed on the derived amount; `updatePurchase` recomputes amount; the
  qty-floor guard still holds.
- Migration test (extend `tests/db/schema.test.ts`): a legacy `purchases` table
  without the new columns gains them after `initSchema`.
- The purchase form is verified via typecheck + the suite staying green + the
  operator's manual pass (reactive amount, pincode autofill, inline validation).

## 8. Open items

None.
