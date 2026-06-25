# Sale Form Fixes — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review
**Sub-project:** B of the supplier/sale refinement batch (A = Suppliers entity, C = plain-English error sweep — separate specs).

## 1. Purpose

Three fixes to the New Sale / Fill-reserved-invoice screen (`NewSale.tsx`):

1. **Vehicle number is mandatory** (today it is optional and hidden under a collapse).
2. **Over-draw is caught live** — typing a quantity larger than a lot's available
   stock shows a clear error immediately and blocks Save, instead of only erroring
   on Save / Save-PDF from the main process.
3. **The chosen buyer's details are shown read-only** — selecting a buyer prefills
   GSTIN + billing address for confirmation; those details can be changed only from
   the Customers screen, never inside the sale.

All user-facing messages on this screen are written in plain, non-technical English.

## 2. Decisions (locked)

- **Vehicle required.** The Vehicle field moves out of the "Optional" collapse into
  the always-visible top area. Empty vehicle → inline error and Save disabled. The
  collapse keeps only the e-way bill fields and is relabelled "Optional (e-way bill)".
- **Over-draw → red inline error, block Save** (chosen over auto-capping). When a
  ticked lot's entered Qty exceeds its `available_kg`, that row shows
  `Only <available> kg available in this lot.` and both Save buttons are disabled
  until every line is within its limit.
- **Buyer details are read-only on this screen.** The buyer is chosen via the
  existing searchable (type-to-search by name) dropdown; on selection the form shows
  the buyer's GSTIN and billing address as read-only text, with a muted note that
  they are edited on the Customers screen. No inline editing of buyer fields.
- **Single `valid` gate disables Save**, matching `PurchaseForm`/`CustomerForm`.
- No schema change, no main-process logic change. The existing main-process draw-down
  guard stays as a backstop.

## 3. Validation logic (extracted + tested)

The save-gating logic is extracted into a pure, unit-tested helper module
`src/renderer/lib/sale-validation.ts` (renderer lib, no React/window.api):

```ts
// A single ticked lot's draw, with its available stock.
export interface LotDraw { include: boolean; qty: number; rate: number; available: number }

// Per-lot error message (empty string = ok). Only ticked lots are validated.
export function lotDrawError(d: LotDraw): string {
  if (!d.include) return ''
  if (d.qty <= 0) return 'Enter a quantity.'
  if (d.qty > d.available) return `Only ${d.available} kg available in this lot.`
  if (d.rate <= 0) return 'Enter a selling rate.'
  return ''
}

export interface SaleFormState {
  hasBuyer: boolean
  vehicle: string
  lots: LotDraw[]   // all visible lots (the helper filters to ticked ones)
}

// Whole-form gate: a clear reason string, or '' when the form may be saved.
export function saleFormError(s: SaleFormState): string {
  if (!s.hasBuyer) return 'Please choose a buyer.'
  if (!s.vehicle.trim()) return 'Enter the vehicle number.'
  const ticked = s.lots.filter(l => l.include && l.qty > 0)
  if (ticked.length === 0) return 'Tick at least one stock lot, then enter its quantity and selling rate.'
  for (const l of s.lots) { const e = lotDrawError(l); if (e) return e }
  return ''
}
```

`saleFormError(...) === ''` is the `valid` flag that enables the Save buttons.
`lotDrawError(...)` drives each row's inline message.

## 4. Screen changes (`NewSale.tsx`)

- **Vehicle:** render the Vehicle `TextInput` in the always-visible top `Paper`
  (with the buyer row), `withAsterisk`, `error={attempted-or-touched ? vehicleErr : undefined}`
  via the existing inline pattern; remove it from the `Collapse`. The collapse button
  text becomes `Optional (e-way bill)`.
- **Lot rows:** below each ticked row's Qty input, render `lotDrawError(...)` (when
  non-empty) as red helper text (e.g. a `<Text c="red" size="xs">`). The `available`
  passed in is the lot's `available_kg`.
- **Buyer read-only details:** when a buyer is selected, the existing place-of-supply
  hint is joined by a read-only block showing `GSTIN` and the billing address
  (`address, city, state — pincode`), plus a muted line: "To edit these, open the
  Customers screen." Rendered as plain `Text`, not inputs.
- **Save gating:** compute `const formError = saleFormError({ hasBuyer: !!buyer, vehicle, lots: <mapped> })`.
  Both **Save** and **Save & preview PDF** buttons get `disabled={formError !== ''}`.
  When `formError` is non-empty it is shown as a **calm muted helper line** next to the
  Save buttons (e.g. `<Text size="sm" c="dimmed">`), naming the single next thing to
  fix — so the screen does not open painted red, but the user always knows why Save is
  off. The existing top red `Alert` is reserved for an actual save-time exception
  thrown by the main process (`setError(...)` in the `catch`).
- **Vehicle** uses `withAsterisk`; an over-drawn lot's row is the one place that turns
  red live (it is a concrete factual error, not a "you haven't filled this yet" state).
- The `save()` function keeps its current main-process call and its existing guards as
  a backstop; the new gate simply prevents reaching it while invalid.

## 5. Plain-English messages on this screen

| Before | After |
|---|---|
| `Choose a buyer first.` | `Please choose a buyer.` |
| `Tick at least one lot and enter quantity + rate.` | `Tick at least one stock lot, then enter its quantity and selling rate.` |
| `Enter a rate greater than 0 for every chosen lot.` | `Enter a selling rate.` (per-lot) |
| (none — over-draw only failed on save) | `Only <n> kg available in this lot.` |
| (none — vehicle was optional) | `Enter the vehicle number.` |

## 6. Out of scope

- Suppliers entity and the purchase supplier picker (sub-project A).
- The app-wide plain-English error sweep beyond this screen (sub-project C).
- Any change to tax, numbering, draw-down, or schema.
- "Add new customer" without leaving the sale (not requested; buyer is chosen from
  existing customers, edited only on the Customers screen).

## 7. Testing

- **Unit tests** (`tests/renderer/sale-validation.test.ts`, Vitest) for
  `lotDrawError` and `saleFormError`:
  - not included → `''`; included with `qty>available` → the `Only N kg…` message;
    included with `qty<=available` and `rate>0` → `''`; `qty<=0` → `Enter a quantity.`;
    `rate<=0` → `Enter a selling rate.`
  - `saleFormError`: no buyer → buyer message; buyer but blank vehicle → vehicle
    message; buyer + vehicle but no ticked lot → the "tick at least one" message; an
    over-drawn lot → the over-draw message; a fully valid form → `''`.
- The full existing suite (93) stays green; `npm run typecheck` and `npm run build`
  stay clean. The screen wiring is verified by typecheck + suite + the operator's
  manual pass (over-draw turns the row red and disables Save; blank vehicle disables
  Save; selecting a buyer shows read-only GSTIN/address).

## 8. Open items

None.
