# Structured Seller Address Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the seller's generic address textbox with a structured pincode-driven block (Pincode → City + Home state + Street) in onboarding and Settings, and show city/state on the invoice.

**Architecture:** Add `seller_city`/`seller_pincode` to the `Settings` type + defaults (the `settings` store is key/value, so no DB migration). Reuse the existing `PincodeField`/`StateSelect`/`isPincode`. Pure UI + settings round-trip; no new core logic.

**Tech Stack:** React 18, TypeScript, Electron.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-seller-structured-address-design.md` is authoritative.
- **No DB migration:** `settings` is key/value; `getSettings` overlays `DEFAULT_SETTINGS`, so new keys default to `''` automatically.
- **Pincode auto-fills Home state:** the seller `PincodeField.onResolved` sets City + Home state; the `StateSelect` dropdown stays editable and is still **mandatory**. Pincode is optional, but if entered must pass `isPincode` (6 digits).
- **`seller_address` is the street line.** Home state remains the seller's tax state.
- Renderer reaches data only via `window.api.*`. Verify via `npm run typecheck` + `npm test` + `npm run build` (no `npm run dev` headless). No new automated tests (no new logic; reuses validated `lookupPincode`/`isPincode`).

---

## File Structure

- `src/shared/types.ts` — `Settings` gains `seller_city`, `seller_pincode`.
- `src/main/core/reference.ts` — `DEFAULT_SETTINGS` gains the two keys.
- `src/renderer/screens/FirstRun.tsx` — structured seller address block.
- `src/renderer/screens/Settings.tsx` — same structured block in the Business section.
- `src/renderer/invoice/InvoiceTemplate.tsx` — seller line shows street + city + state.

---

## Task 1: Structured seller address (onboarding + settings + invoice)

**Files:**
- Modify: `src/shared/types.ts`, `src/main/core/reference.ts`, `src/renderer/screens/FirstRun.tsx`, `src/renderer/screens/Settings.tsx`, `src/renderer/invoice/InvoiceTemplate.tsx`
- Test: none new (verify via typecheck + suite + build)

**Interfaces:**
- Produces: `Settings.seller_city: string`, `Settings.seller_pincode: string` (consumed by FirstRun, Settings, InvoiceTemplate).
- Consumes: `PincodeField({ value, onChange, onResolved })`, `StateSelect`, `isPincode` (`@shared/validation`).

- [ ] **Step 1: Add the two settings keys**

`src/shared/types.ts` — in `interface Settings`, add after `seller_phone: string`:
```ts
  seller_city: string
  seller_pincode: string
```

`src/main/core/reference.ts` — change `DEFAULT_SETTINGS` so the first line includes the two keys:
```ts
export const DEFAULT_SETTINGS: Settings = {
  seller_name: '', seller_address: '', seller_gstin: '', seller_pan: '', seller_phone: '',
  seller_city: '', seller_pincode: '', home_state: '',
  invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10
}
```

- [ ] **Step 2: Onboarding — structured address** (`src/renderer/screens/FirstRun.tsx`)

(a) Update imports (line 2-3 area) to add `isPincode` and `PincodeField`:
```tsx
import { isGstin, isPan, isMobile, isPincode, deriveInvoicePrefix } from '@shared/validation'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'
```

(b) Add two state hooks next to the existing `const [address, setAddress] = useState('')`:
```tsx
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
```

(c) Change the `valid` expression: drop the `address.trim().length > 0` requirement (street is optional) and add the optional-pincode rule. Replace the whole `const valid =` block with:
```tsx
  const valid =
    !!folder && name.trim().length > 0 && isGstin(gstin) && isPan(pan) &&
    isMobile(mobile) && homeState.trim().length > 0 && prefix.trim().length > 0 &&
    (pincode === '' || isPincode(pincode))
```

(d) In `start()`'s `saveSettings({...})` call, add the city + pincode keys (keep `seller_address` as the street line):
```tsx
        seller_phone: mobile.trim(), seller_address: address.trim(),
        seller_city: city.trim(), seller_pincode: pincode.trim(), home_state: homeState,
```

(e) Replace the single Address field (`<div className="field full"><label>Address</label><textarea value={address} ... /></div>`) with a structured block. The existing **Home state** field stays where it is; insert these before it is not required — just replace the Address field block with:
```tsx
            <div className="field"><label>Pincode</label>
              <PincodeField value={pincode} onChange={setPincode}
                onResolved={r => { setCity(r.city); setHomeState(r.state) }} />
              {fieldErr(pincode.length > 0 && !isPincode(pincode), '6-digit pincode')}</div>
            <div className="field"><label>City</label>
              <input value={city} onChange={e => setCity(e.target.value)} /></div>
            <div className="field full"><label>Street address</label>
              <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} /></div>
```
(The "Home state (for tax)" field with `<StateSelect value={homeState} onChange={setHomeState} />` remains as-is in the grid; the pincode auto-fills it via `onResolved`.)

- [ ] **Step 3: Settings — same structured block** (`src/renderer/screens/Settings.tsx`)

(a) Add the import: `import PincodeField from '../components/PincodeField'`.

(b) The current Address field is:
```tsx
        <div className="field"><label>Address</label><textarea value={s.seller_address} onChange={e => set({ seller_address: e.target.value })} /></div>
```
Replace it with a pincode + city + street group (place it just before the row that holds Mobile/Home state):
```tsx
        <div className="row">
          <div className="field"><label>Pincode</label>
            <PincodeField value={s.seller_pincode} onChange={v => set({ seller_pincode: v })}
              onResolved={r => set({ seller_city: r.city, home_state: r.state })} /></div>
          <div className="field grow"><label>City</label>
            <input value={s.seller_city} onChange={e => set({ seller_city: e.target.value })} /></div>
        </div>
        <div className="field"><label>Street address</label><textarea value={s.seller_address} onChange={e => set({ seller_address: e.target.value })} /></div>
```
(The existing Mobile + Home state row stays; the Home state dropdown is now also auto-filled by the pincode.)

- [ ] **Step 4: Invoice — seller line shows city + state** (`src/renderer/invoice/InvoiceTemplate.tsx`)

Replace the seller address line:
```tsx
        <div><h2>{settings.seller_name}</h2><div>{settings.seller_address}</div>
```
with:
```tsx
        <div><h2>{settings.seller_name}</h2><div>{[settings.seller_address, settings.seller_city, settings.home_state].filter(Boolean).join(', ')}</div>
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green (the two new `Settings` keys round-trip via `getSettings`/`saveSettings`; the existing `invoice-template` test still passes — the seller line now joins the fields, and the test fixtures leave city/pincode empty so the line is just the address). Do NOT run `npm run dev`.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/core/reference.ts src/renderer/screens/FirstRun.tsx src/renderer/screens/Settings.tsx src/renderer/invoice/InvoiceTemplate.tsx
git commit -m "feat: structured seller address (pincode -> city + home state + street) in onboarding, settings, invoice"
```

---

## Notes for the implementer

- The seller **pincode auto-fills the Home state** via `onResolved` (City + State), while the `StateSelect` dropdown stays editable and mandatory — same pattern as the customer/supplier forms.
- Street address (`seller_address`) is now optional in onboarding; Home state stays required.
- No DB migration: `settings` is key/value, so the new keys default to `''` through `getSettings`'s overlay on `DEFAULT_SETTINGS`.
- If the existing `invoice-template` test asserts on the seller address text, confirm its fixture's `seller_city`/`home_state` and adjust the expected joined string if needed (the test's `settings` fixture has `home_state: 'Gujarat'`, so the seller line would read `"<address>, Gujarat"` when city is empty — update the assertion if it checks that line exactly).
