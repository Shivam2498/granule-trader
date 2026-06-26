# Invoice Template — Exact Match to ST_006 — Design Spec

**Date:** 2026-06-26
**Status:** Draft for review

## 1. Purpose

Rebuild the sales invoice so the printed/PDF output matches the business's existing
Indian GST **TAX INVOICE** format (reference: `ST_006/2025-26`, Shivam Traders) — a
dense, fully-bordered layout with seller/meta header, Buyer | Consignee columns, a
line-items table with embedded CGST/SGST/R-Off rows, an HSN-wise tax summary,
amount-in-words, a bank + declaration block, a signature block, and **two copies
(Original + Duplicate)**.

The reference has **no logo and no image signature** — it is entirely text — so no image
storage/embedding is required.

## 2. Decisions (locked)

- **Unique business details come from Settings (editable); generic boilerplate text is
  hardcoded in the template.**
  - From Settings (existing): seller name, office address, city, state, GSTIN, PAN, phone.
  - From Settings (**new fields**): Godown address, UDYAM No., Email, Bank name, Bank
    branch, Bank A/C No., IFSC.
  - Hardcoded boilerplate: declaration paragraph, Payment Terms ("Immediate"), Delivery
    Terms ("Ex-Godown - Freight arranged & paid by party"), all static labels/column
    headers, "Customer's Seal & Signature", "Original"/"Duplicate". Anywhere the business
    **name** appears in boilerplate ("for <NAME>", "Cheque/RTGS in name of <NAME>") it is
    interpolated from `seller_name`, not hardcoded.
- **Per-invoice data** (invoice no, date, e-Way Bill no+date, vehicle, buyer (billing),
  consignee (shipping), Place of Supply = buyer state, line items, taxes, amount-in-words)
  comes from the sale.
- **Order No / Delivery Note / Remarks:** rendered as **blank labelled rows** — no per-sale
  capture, no schema change (matches how `ST_006` prints them). *Open for review: can be
  upgraded to optional per-sale fields if desired (adds a sale schema migration + form
  inputs).*
- **Line items consolidate allocations by `(HSN, gst_rate)`** into one row (multiple FIFO
  lots at one selling rate → a single product line, as in `ST_006`). Description of goods =
  the HSN product's description.
- **Two copies:** the page renders twice — Original then Duplicate — identical except the
  top-right marker.
- **Intra-state vs inter-state:** if `sale.igst > 0` → IGST columns; else CGST + SGST
  (existing rule, preserved).

## 3. New Settings fields (captured in onboarding **and** Settings, required)

Add to `DEFAULT_SETTINGS` (src/main/core/reference.ts), the `Settings` type
(src/shared/types.ts), the Settings "Business" form (src/renderer/screens/Settings.tsx),
**and the onboarding form** (src/renderer/screens/FirstRun.tsx) as plain text inputs:

| key | label |
|---|---|
| `seller_godown_address` | Godown address |
| `seller_udyam` | UDYAM No. |
| `seller_email` | Email |
| `bank_name` | Bank name |
| `bank_branch` | Bank branch |
| `bank_account_no` | Bank A/C No. |
| `bank_ifsc` | IFSC |

- All default to `''`. The settings table is key-value, so `getSettings`/`saveSettings`
  pick them up automatically once they are in `DEFAULT_SETTINGS` and the type.
- No DB migration needed (settings are rows, not columns); a fresh or existing DB returns
  `''` for any unset key.
- **Required in both forms:** each new field gets an `isNotEmpty(...)` validator (same
  pattern as the existing required fields), so onboarding cannot complete and Settings
  cannot save with any of them blank. This guarantees every invoice has bank/UDYAM/email
  /godown details.
- **Onboarding placement:** the seven fields are added to the FirstRun "Your business"
  section. Because `FirstRun.start()` already sends its whole form via `saveSettings`, it
  must include these new keys in that payload. (The person receiving the pre-built `.db`
  skips onboarding via the choose-existing-folder path, so these matter for the operator
  who first sets the data up — requiring them ensures completeness before hand-off.)
- They also appear in the existing "Business" Settings card (so they can be edited later),
  with the same required validation.

## 4. Amount-in-words helper

New pure module `src/renderer/lib/words.ts`:

```ts
// Indian numbering (lakh/crore). Splits rupees and paise.
// 260000      -> "Rupees Two lakh sixty thousand only"
// 39661.20    -> "Rupees Thirty-nine thousand six hundred sixty-one and twenty paise only"
export function rupeesInWords(amount: number): string
```

- Indian grouping words (thousand, lakh, crore). Paise = round(fractional * 100); when
  non-zero, append "and <words> paise"; always end with "only".
- Deterministic and unit-tested (no locale/Intl dependency).

## 5. Template structure (`InvoiceTemplate.tsx` + `invoice.css` rewrite)

A single bordered table-based layout reproduced for each copy. Top to bottom:

1. **Title row:** centered "TAX INVOICE"; top-right copy marker ("Original" / "Duplicate").
2. **Seller block (left) | Invoice meta (right):**
   - Left: `seller_name` (bold), `Off: <office address>`, `Godown: <godown address>`,
     state, `GSTIN/UIN`, `PAN/IT No.`, `UDYAM No.`, `Email`.
   - Right (label/value grid): Invoice No, Date; e-Way Bill No, Date; Delivery Note, Date
     (blank); Order No, Date (blank); Payment Terms (hardcoded); Vehicle No; Delivery Terms
     (hardcoded); Remarks (blank).
3. **Buyer (if other than consignee) | Consignee** — two columns. Each: name, address lines
   (from billing/shipping JSON), GSTIN/UIN, PAN/IT No., State Name, Place of Supply.
   Consignee falls back to buyer when shipping is empty.
4. **Line-items table:** columns `Sl No. | DESCRIPTION OF GOODS | HSN/SAC | Qty | Unit |
   Rate/Unit | AMOUNT Rs.`. One consolidated row per `(HSN, rate)` group; Unit = "Kgs";
   amounts via `formatINR` minus the symbol where the reference shows plain numbers (match
   reference: amounts as `2,20,340.00`). Below the rows, right-aligned in the amount column:
   `CGST`, `SGST` (or `IGST`), `R/Off`, then a bold **TOTAL** row with total qty + "Kgs" and
   grand total.
5. **Amount Chargeable (in words)** + `E.& O.E`; line: `rupeesInWords(total_invoice_amount)`.
6. **HSN-wise tax summary table:** `HSN/SAC | Taxable Value | Central Tax (Rate, Amount) |
   State Tax (Rate, Amount) | Total Tax Amount`, with a bold **Total** row. (Inter-state:
   IGST replaces the two halves.) Then **Tax Amount (in words):** `rupeesInWords(totalTax)`.
7. **Declaration + bank block:** "DECLARATION:" + hardcoded declaration paragraph (left);
   `Cheque/RTGS in name of "<seller_name>"`, `Bank Name`, `Branch`, `A/C No.`, `IFS Code`
   from Settings (right).
8. **Signature row:** "Customer's Seal & Signature" (left) | "for <seller_name>" (right),
   with empty space for the seal.

`invoice.css` provides the bordered grid (collapsed borders, small font, fixed column
widths) approximating the reference. Print CSS keeps each copy on its own page.

## 6. Data flow

- `InvoiceView` already loads the sale + allocations + settings. It must additionally fetch
  `listHsn()` and pass an HSN→description map (or pre-joined line items) to the template so
  the "DESCRIPTION OF GOODS" column can show the product description. (The template stays a
  pure presentational component receiving `{ sale, allocations, settings, hsnDescriptions }`.)
- Tax grouping and intra/inter-state logic reuse the existing approach in the current
  `InvoiceTemplate.tsx` (HSN-wise taxable accumulation), extended to the reference layout.

## 7. Testing

- **`tests/renderer/words.test.ts`** — `rupeesInWords`: whole rupees ("…only"), with paise
  ("…and twenty paise only"), lakh/crore grouping, zero, and the two exact strings from
  `ST_006` (₹2,60,000 and ₹39,661.20).
- **Template logic** (where pure): HSN+rate consolidation produces one line per group;
  CGST/SGST split vs IGST switch; tax-summary totals. Rendered via a jsdom test asserting
  key cells (invoice no, consignee, total, in-words) appear.
- Verified by `npm run typecheck` + suite green + `npm run build`, plus an operator pass:
  generate a PDF from a sample sale and visually compare to `ST_006` (both copies present,
  totals and words correct, bank/declaration block correct).

## 8. Out of scope

- Logo / image signature (reference has none).
- Per-sale Order No / Delivery Note / Remarks capture (rendered blank; see §2 open item).
- Changing tax computation, FIFO allocation, or invoice numbering.
- Customer/Supplier CSV import and Windows packaging (separate specs).

## 9. Open items

- Confirm Order No / Delivery Note / Remarks stay blank (recommended) vs. become optional
  per-sale fields (adds a sale schema migration + form inputs).
