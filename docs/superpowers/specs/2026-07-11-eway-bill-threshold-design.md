# E-way Bill Mandatory Over ₹50,000 — Design

**Date:** 2026-07-11
**Status:** Implemented

## Purpose

GST requires an e-way bill once a consignment's value exceeds ₹50,000. Until now the e-way
bill number and date sat behind a collapsed **"Optional (e-way bill)"** toggle on the New Sale
screen and were never required, so a large sale could be saved and printed without one.

## Rule

An e-way bill (**both** number and date) is mandatory when the **invoice total exceeds ₹50,000**.

- **"Total" means the invoice value the buyer pays** — taxable amount + CGST/SGST/IGST + round-off —
  not the pre-tax amount. This matters: a ₹45,000 taxable sale invoices at ₹53,100 with 18% GST and
  legally needs an e-way bill. Gating on the taxable amount would have missed it.
- **The comparison is strictly greater than.** ₹50,000 exactly does not need one; the statute says
  "exceeds ₹50,000".
- **The threshold is a fixed constant**, `EWAY_BILL_THRESHOLD` in `src/shared/tax.ts`, not a Settings
  field. It is a statutory figure, and a Settings box the owner could accidentally zero out would
  silently make e-way bills mandatory on every sale.

## Where it is enforced

In the form gate — `saleFormError` in `src/renderer/lib/sale-validation.ts` — which disables Save
and shows a single plain-English reason.

It is deliberately **not** enforced in `writeSale` (`src/main/core/sale.ts`). The core layer guards
invariants that would corrupt data: stock going negative, duplicate invoice numbers, a financial
year that disagrees with the invoice date. A missing e-way bill is a compliance/paperwork rule, not
a data-integrity one, and this matches the existing pattern — "vehicle is required" is likewise a
form gate, not a core invariant. Sales are only ever created through this one screen.

## Ordering

The e-way bill check runs **last** in `saleFormError`, after the lots are validated. The total is
only meaningful once the lots are settled, so checking earlier would nag the user about a figure
they have not finished building.

## UI behaviour

Once the running total crosses the threshold, the e-way bill section:

- **opens itself and stays open** (the toggle is disabled) — a required field hidden behind a
  collapsed toggle is a trap;
- **relabels** from "Optional (e-way bill)" to "E-way bill (required — this sale is over ₹50,000.00)";
- marks both fields with an asterisk and shows "Required over ₹50,000." on whichever is blank.

The Save button's reason line reads, e.g.:
*"This sale comes to ₹53,100.00, which is over ₹50,000.00 — enter the e-way bill number."*

## Tests

- `tests/shared/tax.test.ts` — `ewayBillRequired` boundary: below, exactly at, and above ₹50,000.
- `tests/renderer/sale-validation.test.ts` — the gate asks for the number, then the date, is satisfied
  by both, treats whitespace as blank, and still asks for lots first.
