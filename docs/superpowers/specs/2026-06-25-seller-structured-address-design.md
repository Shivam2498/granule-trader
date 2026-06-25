# Granule Trader — Structured Seller Address Design Spec

**Date:** 2026-06-25
**Status:** Draft for review

## 1. Purpose

The onboarding (FirstRun) form still captures the seller's address as a single
generic textbox plus a separate Home-state dropdown — unlike the supplier and
customer forms, which use a pincode-driven City/State + street layout. Make the
seller address structured the same way, in onboarding and in Settings (so it
stays editable).

## 2. Decisions (locked)

- Structured seller address everywhere it is entered: **Pincode → auto City +
  Home state**, plus editable City, Home state (dropdown), and a Street-address
  line.
- The seller **pincode auto-fills the Home state** (the business's state, used
  for intra/inter GST), with the `StateSelect` dropdown still editable as the
  source of truth / fallback. Home state remains mandatory.
- No DB migration: `settings` is a key/value store; new keys default to empty via
  `getSettings`'s overlay on `DEFAULT_SETTINGS`.

## 3. Data

Add two keys to the `Settings` type and `DEFAULT_SETTINGS`
(`src/main/core/reference.ts`):

| Key | Type | Notes |
|---|---|---|
| seller_city | string | seller city (auto-filled from pincode) |
| seller_pincode | string | seller 6-digit pincode |

`seller_address` is repurposed as the **street-address line**. `home_state`
(existing) remains the seller's state. `getSettings`/`saveSettings` already
round-trip arbitrary keys, so no other storage change is needed.

## 4. Onboarding (FirstRun) — `src/renderer/screens/FirstRun.tsx`

Replace the single "Address" textbox with a structured block under "Your
business":
- **Pincode** (`PincodeField`) → on a valid 6-digit value, auto-fills City +
  Home state.
- **City** (text, editable).
- **Home state** (`StateSelect`, mandatory — unchanged, now also auto-filled).
- **Street address** (text line, optional).

Validation (in addition to the existing required name/GSTIN/PAN/mobile/home
state/folder): pincode is optional but, if entered, must pass `isPincode`
(6 digits). On submit, save `seller_city`, `seller_pincode`, `seller_address`
(street) alongside the existing fields.

## 5. Settings — `src/renderer/screens/Settings.tsx`

Mirror the same structured block in the Business section: Pincode (auto-fills
city + home state) · City · Home state (`StateSelect`, already present) · Street
address. Bind to `seller_city`, `seller_pincode`, `seller_address`. (The screen
already loads/saves the full `Settings` object, so the new keys round-trip
automatically once added to the type.)

## 6. Invoice — `src/renderer/invoice/InvoiceTemplate.tsx`

The seller block currently prints `settings.seller_address`. Update it to print a
combined line: street address, city, and home state (e.g. `GIDC, Surat,
Gujarat`), skipping empty parts — a small consistency touch so the new fields
appear on the invoice. GSTIN/PAN/phone line unchanged.

## 7. Out of scope / unaffected

Customers, suppliers/purchases, sales, stock, tax, migrations — no changes. No
new dependencies (reuses `PincodeField`, `StateSelect`, `isPincode`).

## 8. Testing

The seller fields are UI + settings round-trip; verify via typecheck + the suite
staying green + the operator's manual pass (onboarding pincode fills city + home
state; Settings shows/saves the structured block; invoice seller line shows
city/state). No new core unit tests required (no new logic — reuses existing
validated `lookupPincode`/`isPincode`).

## 9. Open items

None.
