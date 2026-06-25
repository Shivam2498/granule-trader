# Plain-English Error Messages + formatAddress Helper — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review
**Sub-project:** C of the supplier/sale refinement batch (A Suppliers + B sale fixes merged; D FY-ledger and E form-migration parked).

## 1. Purpose

The app's users are not tech-savvy. Today several messages are terse or technical
(`Invoice number must look like RP/008/2024-25 (got "...")`, bare `Required`,
`Cannot delete: this lot is used by one or more sales`). Rewrite **every user-facing
message** — thrown core errors, inline field validation, and form-level banners — in
clear, plain English, and de-duplicate the two pieces of repeated UI logic this touches
(`formatAddress`, the shared validation-message strings).

## 2. Decisions (locked)

- **In-place rewrite** (not a central message catalog): each string is rewritten where
  it lives. Two small shared helpers are extracted only for genuinely repeated logic.
- **Tone:** a full sentence, ending with a period, addressed to "you", saying what to
  do; **no codes, regexes, or raw debug values** (drop the `(got "...")` part).
- **`Required` becomes field-specific** (`Enter the city.`, `Enter the address.`) — a
  generic word replaced by a concrete instruction.
- **No behavior change** — only message text and the two helper extractions. No logic,
  validation rules, tax, numbering, or schema changes.
- **Confirm dialogs are already plain** (`Delete this sale? Stock will be restored.`)
  and are left unchanged.

## 3. Shared helpers

### 3.1 `formatAddress` (renderer)

Add to `src/renderer/lib/format.ts`:

```ts
export function formatAddress(p: { address?: string; city?: string; state?: string; pincode?: string }): string {
  const line = [p.address, p.city, p.state].filter(Boolean).join(', ')
  return p.pincode ? (line ? `${line} — ${p.pincode}` : p.pincode) : line
}
```

Replaces the hand-rolled join currently duplicated in:
- `NewSale.tsx` (buyer read-only block),
- `PurchaseForm.tsx` (supplier read-only block),
- `InvoiceTemplate` (the private `addr()` closure) — **only** if its output is
  byte-identical to the current print output; if the template's format differs (e.g.
  newlines for print), leave the template as-is and note it. Print fidelity wins.

### 3.2 Shared validation messages

The GSTIN / phone / pincode validation strings are currently duplicated across
`CustomerForm`, `SupplierForm`, and `FirstRun`. Export them as constants next to the
predicates in `src/shared/validation.ts`:

```ts
export const VMSG = {
  gstin: 'Enter a valid GSTIN, like 24ABCDE1234F1Z5.',
  phone: 'Enter a 10-digit phone number.',
  pincode: 'Enter a 6-digit pincode.'
} as const
```

`CustomerForm`, `SupplierForm`, and `FirstRun` import and use these instead of inline
literals, so the wording stays identical everywhere.

## 4. Message rewrites (authoritative table)

### 4.1 Thrown core errors

| File:line | Before | After |
|---|---|---|
| `adjustment.ts:15` | `Lot not found` | `We couldn't find that stock lot.` |
| `adjustment.ts:17` | `This lot only has ${q} kg left` | `This lot only has ${q} kg available.` |
| `sale.ts:34` | `Invoice number must look like RP/008/2024-25 (got "${n}")` | `Please enter the invoice number in the format RP/008/2024-25.` |
| `sale.ts:46` | `Lot ${code} only has ${have} kg left as of ${date}` | `Lot ${code} only has ${have} kg available on ${date}.` |
| `purchase.ts:85` | `Purchase not found` | `We couldn't find that purchase.` |
| `purchase.ts:88` | `Quantity cannot be below ${n} kg already drawn from this lot` | `You've already sold ${n} kg from this lot, so the quantity can't be less than that.` |
| `purchase.ts:118` | `Cannot delete: this lot is used by one or more sales. Delete those sales first.` | `This lot is used in one or more sales. Please delete those sales first.` |
| `invoice-validation.ts:27` | `Date must be on or after ${d} to keep invoice order valid` | `Pick a date on or after ${d} so invoices stay in order.` |
| `invoice-validation.ts:29` | `Date must be on or before ${d} to keep invoice order valid` | `Pick a date on or before ${d} so invoices stay in order.` |

(Note `sale.ts:46` and `adjustment.ts:17` keep the substring `only has ${n}`, so the
tests matching `/only has 500/` and `/only has 100/` stay green.)

### 4.2 Form-level banners (screens)

| File | Before | After |
|---|---|---|
| `FirstRun.tsx:44` | `Please complete the highlighted fields below.` | `Please fix the highlighted fields below.` |
| `CustomerForm.tsx:53` | `Please fix the highlighted fields.` | `Please fix the highlighted fields below.` |
| `PurchaseForm.tsx:76` | `Please fix the highlighted fields.` | `Please fix the highlighted fields below.` |
| `StockAdjust.tsx:28` | `Choose a lot and a quantity greater than 0.` | `Please choose a lot and enter a quantity greater than 0.` |

### 4.3 Inline field validation (screens)

- GSTIN / phone / pincode literals → `VMSG.gstin` / `VMSG.phone` / `VMSG.pincode`
  (CustomerForm, SupplierForm, FirstRun).
- Bare `Required` → a field-specific instruction at each site:
  - name → `Enter the name.` (or `Enter the business name.` in FirstRun)
  - city → `Enter the city.`; state → `Choose the state.`; address → `Enter the address.`
  - (PurchaseForm) `our_code` Required → `Enter the code.`; `invoice_date` Required →
    `Pick the invoice date.`; `hsn_code` Required → `Choose the HSN.`
- `Enter a quantity` → `Enter a quantity.`; `Enter a rate` → `Enter a rate per kg.`
  (period + clarity).
- The NewSale messages (`Only N kg available in this lot.`, `Enter the vehicle number.`,
  etc.) were already written plainly in sub-project B — left as-is.

## 5. Tests to update

Changing two thrown strings breaks two existing assertions; update them to the new
wording (same `toThrow` style):

- `tests/core/purchase.test.ts:48` — `/used by one or more sales/` → `/used in one or more sales/`.
- `tests/core/purchase.test.ts:58` — `/below 600/` → `/already sold 600/`.

Unchanged-substring assertions stay green: `sale.test.ts` `/only has 500/`,
`adjustment.test.ts` `/only has 100/`.

New test: `formatAddress` (`tests/renderer/format.test.ts` already exists for this
module): all four fields → `addr, city, state — pincode`; missing pincode → no dash;
only pincode → just the pincode; all empty → `''`.

## 6. Out of scope

- A central message catalog / i18n (chosen: in-place).
- Any logic, validation-rule, tax, numbering, or schema change.
- Rewriting messages already made plain in sub-project B (NewSale).
- Touching the printable invoice format if `formatAddress` would change its output.

## 7. Testing & verification

- `formatAddress` unit-tested; the two updated `toThrow` assertions pass.
- Full suite + `npm run typecheck` + `npm run build` stay green.
- Operator manual pass: trigger a couple of errors (over-draw on a sale, delete a lot
  used by a sale, bad invoice date) and confirm the messages read as plain English.

## 8. Open items

None.
