# PAN Auto-Derived from GSTIN + Customer Phone Mandatory — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review

## 1. Purpose

A GSTIN embeds the entity's PAN (characters 3–12). Today PAN is a separate,
optional, manually-typed field — which is redundant, error-prone (it can mismatch
the GSTIN or be left blank), and was the source of a confusing "button stays
disabled" episode. Make PAN **auto-derived from the GSTIN and read-only**, for both
customers and the seller, and make the **customer phone mandatory**.

## 2. Decisions (locked)

- **PAN is auto-derived and locked** (read-only / `disabled`, greyed) everywhere it
  appears — derived live from the GSTIN, never typed.
- Applies to **customers** and the **seller** (onboarding + Settings).
- **Customer phone becomes mandatory** (10-digit, inline error, blocks save).
- No schema change (PAN columns already exist; they're just populated from the
  derived value).

## 3. GSTIN ⇒ PAN

GSTIN is 15 chars: `[2 state digits][10-char PAN][1 entity char][Z][1 checksum]`.
The PAN is characters 3–12, i.e. `gstin.slice(2, 12)`. Example:
`24CCGPC8555A1Z5` → `CCGPC8555A`.

## 4. Shared helper

Add to `src/shared/validation.ts` (pure, tested):

```ts
export function panFromGstin(gstin: string): string {
  const g = gstin.trim().toUpperCase()
  return g.length >= 12 ? g.slice(2, 12) : ''
}
```

- Derives the PAN as soon as the GSTIN is at least 12 characters (the PAN portion
  is complete by then), so it fills in while the user types the GSTIN.
- A valid 15-char GSTIN (passing `isGstin`) always yields a PAN that passes
  `isPan`, so no separate PAN validation is needed once GSTIN is valid.

## 5. Customer form (`CustomerForm.tsx`)

- **GSTIN** input (unchanged required + format) — its `onChange` now also sets the
  derived PAN: `set({ gstin: g, pan: panFromGstin(g) })`.
- **PAN** field becomes a `disabled` (greyed) `TextInput` showing `form.pan` — no
  manual entry. (It is always present and valid whenever the GSTIN is valid.)
- **Phone** becomes mandatory: the `errs.phone` rule changes from "valid only if
  present" to **required + 10-digit** (`form.phone && isMobile(...) ? '' : (10-digit
  required message)`), with `withAsterisk` on the field; `valid` already gates on
  the full `errs` map, so save is blocked until phone is a valid 10-digit number.
- On save, `pan` is the derived value (already in `form.pan`).

## 6. Seller — onboarding (`FirstRun.tsx`)

- Remove the manually-entered PAN input. The **GSTIN** `onChange` sets both `gstin`
  and `pan` (`setPan(panFromGstin(g))`).
- Render PAN as a `disabled` (greyed) `TextInput` showing the derived `pan`.
- The existing `valid` gate keeps `isPan(pan)` — which now holds automatically once
  the GSTIN is valid, so the user never sees an "empty PAN" block again.

## 7. Seller — Settings (`Settings.tsx`)

- The seller **GSTIN** `onChange` sets `seller_gstin` and `seller_pan`
  (`set({ seller_gstin: g, seller_pan: panFromGstin(g) })`).
- The **PAN** field becomes a `disabled` (greyed) `TextInput` showing
  `s.seller_pan`. `saveSettings` persists `seller_pan` as before (now the derived
  value).

## 8. Out of scope

Suppliers on purchases (supplier PAN is not currently captured), and the
duplicate-GSTIN uniqueness idea (separate, not part of this round). GSTIN remains
mandatory for customers; this spec does not introduce blank-GSTIN customers.

## 9. Testing

- Unit test `panFromGstin` (`tests/shared/validation.test.ts`): valid 15-char
  GSTIN → correct 10-char PAN; an `isPan`-valid result; a too-short GSTIN → `''`.
- The three forms are verified via `npm run typecheck` + the suite staying green +
  the operator's manual pass (PAN auto-fills + greys out as GSTIN is typed; customer
  phone blocks save when empty/invalid).

## 10. Open items

None.
