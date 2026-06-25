# Plain-English Error Messages + formatAddress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite every user-facing message (core errors, form banners, inline field validation) in clear plain English, and de-duplicate the repeated address-join (`formatAddress`) and validation strings (`VMSG`).

**Architecture:** In-place rewrites (no central catalog). Two small shared helpers: `formatAddress` in `src/renderer/lib/format.ts` and a `VMSG` constants object in `src/shared/validation.ts`. Three tasks: shared helpers (TDD) → core error rewrites (+ update 2 test assertions) → screen rewrites (banners, inline validation → VMSG, field-specific `Required`, `formatAddress` usage).

**Tech Stack:** React 18, TypeScript, Mantine v7, @mantine/form, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-plain-english-errors-design.md` is authoritative (§4 table is the message source of truth).
- **Tone:** full sentence, ends with a period, addressed to "you", says what to do; **no codes, regexes, or raw debug values** (drop `(got "...")`).
- **No behavior change** — only message text + the two helper extractions. No logic, validation rules, tax, numbering, or schema changes.
- **Print fidelity:** do NOT change `InvoiceTemplate`'s `addr()` (its `…, pincode` comma format differs from `formatAddress`'s `— pincode`); the printable invoice is untouched.
- Renderer reaches data only via `window.api.*`. Build stays green each task (`npm test` + `npm run typecheck` + `npm run build`). Do NOT run `npm run dev` headless.

---

## File Structure

- `src/renderer/lib/format.ts` — add `formatAddress`.
- `tests/renderer/format.test.ts` — add `formatAddress` tests.
- `src/shared/validation.ts` — add `VMSG`.
- Core: `src/main/core/adjustment.ts`, `sale.ts`, `purchase.ts`, `invoice-validation.ts` — message rewrites.
- `tests/core/purchase.test.ts` — update two `toThrow` assertions.
- Screens: `FirstRun.tsx`, `CustomerForm.tsx`, `SupplierForm.tsx`, `PurchaseForm.tsx`, `NewSale.tsx`, `StockAdjust.tsx` — banners, inline validation, `VMSG`, `formatAddress`.

---

## Task 1: Shared helpers — `formatAddress` + `VMSG`

**Files:**
- Modify: `src/renderer/lib/format.ts`, `src/shared/validation.ts`
- Test: `tests/renderer/format.test.ts`

**Interfaces:**
- Produces (consumed by Task 3):
  - `formatAddress(p: { address?: string; city?: string; state?: string; pincode?: string }): string`
  - `VMSG = { gstin: string; phone: string; pincode: string }` (a `const` object, exported from `@shared/validation`).

- [ ] **Step 1: Write the failing `formatAddress` tests** (append to `tests/renderer/format.test.ts`)

```ts
import { formatAddress } from '../../src/renderer/lib/format'

describe('formatAddress', () => {
  it('joins all four with a dash before pincode', () => {
    expect(formatAddress({ address: '1 Estate Rd', city: 'Surat', state: 'Gujarat', pincode: '395003' }))
      .toBe('1 Estate Rd, Surat, Gujarat — 395003')
  })
  it('omits the dash when pincode is missing', () => {
    expect(formatAddress({ address: '1 Estate Rd', city: 'Surat', state: 'Gujarat' }))
      .toBe('1 Estate Rd, Surat, Gujarat')
  })
  it('skips empty parts', () => {
    expect(formatAddress({ city: 'Surat', state: 'Gujarat' })).toBe('Surat, Gujarat')
  })
  it('returns just the pincode when it is the only field', () => {
    expect(formatAddress({ pincode: '395003' })).toBe('395003')
  })
  it('returns empty string when nothing is provided', () => {
    expect(formatAddress({})).toBe('')
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/renderer/format.test.ts`
Expected: FAIL — `formatAddress` is not exported.

- [ ] **Step 3: Implement `formatAddress`** (add to `src/renderer/lib/format.ts`)

```ts
export function formatAddress(p: { address?: string; city?: string; state?: string; pincode?: string }): string {
  const line = [p.address, p.city, p.state].filter(Boolean).join(', ')
  return p.pincode ? (line ? `${line} — ${p.pincode}` : p.pincode) : line
}
```

- [ ] **Step 4: Add `VMSG`** (append to `src/shared/validation.ts`)

```ts
export const VMSG = {
  gstin: 'Enter a valid GSTIN, like 24ABCDE1234F1Z5.',
  phone: 'Enter a 10-digit phone number.',
  pincode: 'Enter a 6-digit pincode.'
} as const
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/renderer/format.test.ts`
Expected: PASS.

- [ ] **Step 6: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/format.ts tests/renderer/format.test.ts src/shared/validation.ts
git commit -m "feat: formatAddress helper + VMSG shared validation messages"
```

---

## Task 2: Core error message rewrites + test-assertion updates

**Files:**
- Modify: `src/main/core/adjustment.ts`, `src/main/core/sale.ts`, `src/main/core/purchase.ts`, `src/main/core/invoice-validation.ts`
- Test: `tests/core/purchase.test.ts` (update two assertions)

**Interfaces:** none produced; this task only changes thrown-message text.

- [ ] **Step 1: Update the two test assertions first** (`tests/core/purchase.test.ts`)

Change line ~48: `.toThrow(/used by one or more sales/)` → `.toThrow(/used in one or more sales/)`.
Change line ~58: `.toThrow(/below 600/)` → `.toThrow(/already sold 600/)`.

- [ ] **Step 2: Run those tests, verify they now FAIL** (messages not yet changed)

Run: `npx vitest run tests/core/purchase.test.ts`
Expected: FAIL on the two updated assertions (old messages still thrown).

- [ ] **Step 3: Rewrite the messages** (exact replacements)

`src/main/core/adjustment.ts`:
- `throw new Error('Lot not found')` → `throw new Error('We couldn\'t find that stock lot.')`
- `throw new Error(\`This lot only has ${lot.qty_remaining_kg} kg left\`)` → `throw new Error(\`This lot only has ${lot.qty_remaining_kg} kg available.\`)`

`src/main/core/sale.ts`:
- `throw new Error(\`Invoice number must look like RP/008/2024-25 (got "${input.invoice_number}")\`)` → `throw new Error('Please enter the invoice number in the format RP/008/2024-25.')`
- `throw new Error(\`Lot ${lot?.our_code ?? line.purchase_id} only has ${have} kg left as of ${input.invoice_date}\`)` → `throw new Error(\`Lot ${lot?.our_code ?? line.purchase_id} only has ${have} kg available on ${input.invoice_date}.\`)`

`src/main/core/purchase.ts`:
- `throw new Error('Purchase not found')` → `throw new Error('We couldn\'t find that purchase.')`
- `throw new Error(\`Quantity cannot be below ${consumed} kg already drawn from this lot\`)` → `throw new Error(\`You've already sold ${consumed} kg from this lot, so the quantity can't be less than that.\`)`
- `throw new Error('Cannot delete: this lot is used by one or more sales. Delete those sales first.')` → `throw new Error('This lot is used in one or more sales. Please delete those sales first.')`

`src/main/core/invoice-validation.ts`:
- `message: \`Date must be on or after ${prev.invoice_date} to keep invoice order valid\`` → `message: \`Pick a date on or after ${prev.invoice_date} so invoices stay in order.\``
- `message: \`Date must be on or before ${next.invoice_date} to keep invoice order valid\`` → `message: \`Pick a date on or before ${next.invoice_date} so invoices stay in order.\``

(Mind the apostrophes: use a template literal or escape — `You've` / `can't` / `couldn't`. A template literal `` `…` `` avoids escaping the apostrophes.)

- [ ] **Step 4: Run the suite, verify it passes**

Run: `npm test`
Expected: PASS — the two updated assertions now match (`/used in one or more sales/`, `/already sold 600/`); `sale.test.ts` `/only has 500/` and `adjustment.test.ts` `/only has 100/` still match the kept `only has ${n}` substring.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/main/core/adjustment.ts src/main/core/sale.ts src/main/core/purchase.ts src/main/core/invoice-validation.ts tests/core/purchase.test.ts
git commit -m "refactor: plain-English core error messages"
```

---

## Task 3: Screen rewrites — banners, inline validation, VMSG, formatAddress

**Files:**
- Modify: `src/renderer/screens/FirstRun.tsx`, `CustomerForm.tsx`, `SupplierForm.tsx`, `PurchaseForm.tsx`, `NewSale.tsx`, `StockAdjust.tsx`
- Test: none (verify via typecheck + suite + build; the changes are message text + helper usage)

**Interfaces:**
- Consumes from Task 1: `VMSG` from `@shared/validation`, `formatAddress` from `../lib/format`.

- [ ] **Step 1: `StockAdjust.tsx`** — banner

Change `setError('Choose a lot and a quantity greater than 0.')` →
`setError('Please choose a lot and enter a quantity greater than 0.')`

- [ ] **Step 2: `FirstRun.tsx`** — banner, VMSG, field-specific required

(a) `setError('Please complete the highlighted fields below.')` → `setError('Please fix the highlighted fields below.')`
(b) Add `VMSG` to the `@shared/validation` import.
(c) Replace the inline messages:
- GSTIN `error={... 'GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5' : reqErr(gstin)}` → use `VMSG.gstin` in place of the literal.
- Mobile `'Enter a 10-digit mobile number'` → `VMSG.phone`.
- Pincode `'6-digit pincode'` → `VMSG.pincode`.
(d) Make `reqErr` field-specific by giving it a label param:
```tsx
  const reqErr = (v: string, what: string) => (attempted && !v.trim() ? `Enter the ${what}.` : undefined)
```
and update its call sites: business name → `reqErr(name, 'business name')`; invoice prefix → `reqErr(prefix, 'invoice prefix')`; mobile → keep the format check then `reqErr(mobile, 'mobile number')`; GSTIN → `reqErr(gstin, 'GSTIN')`; home state wrapper → `reqErr(homeState, 'home state')`. (The data-folder error `'Choose a data folder'` is already plain — leave it.)

- [ ] **Step 3: `CustomerForm.tsx`** — banner, VMSG, field-specific required

(a) `setError('Please fix the highlighted fields.')` → `setError('Please fix the highlighted fields below.')`
(b) Add `VMSG` to the `@shared/validation` import.
(c) In `errs`, replace literals:
```tsx
    name: form.name.trim() ? '' : 'Enter the name.',
    gstin: isGstin(form.gstin) ? '' : VMSG.gstin,
    phone: isMobile(form.phone) ? '' : VMSG.phone,
    billing_city: form.billing_city.trim() ? '' : 'Enter the city.',
    billing_state: form.billing_state.trim() ? '' : 'Choose the state.',
    billing_pincode: isPincode(form.billing_pincode) ? '' : VMSG.pincode,
    billing_address: form.billing_address.trim() ? '' : 'Enter the address.',
    ...(form.shipping_same ? {} : {
      shipping_address: form.shipping_address.trim() ? '' : 'Enter the shipping address.',
      shipping_city: form.shipping_city.trim() ? '' : 'Enter the shipping city.',
      shipping_state: form.shipping_state.trim() ? '' : 'Choose the shipping state.',
      shipping_pincode: isPincode(form.shipping_pincode) ? '' : VMSG.pincode
    })
```

- [ ] **Step 4: `SupplierForm.tsx`** — VMSG + field-specific required (in the `@mantine/form` `validate` object)

(a) Add `VMSG` to the `@shared/validation` import (alongside `isGstin/isMobile/isPincode/panFromGstin`).
(b) Replace the `validate` rules:
```tsx
    validate: {
      name: isNotEmpty('Enter the name.'),
      gstin: (v) => (isGstin(v) ? null : VMSG.gstin),
      phone: (v) => (isMobile(v) ? null : VMSG.phone),
      city: isNotEmpty('Enter the city.'),
      state: isNotEmpty('Choose the state.'),
      address: isNotEmpty('Enter the address.'),
      pincode: (v) => (isPincode(v) ? null : VMSG.pincode)
    }
```

- [ ] **Step 5: `PurchaseForm.tsx`** — banner, field-specific required, formatAddress

(a) `setError('Please fix the highlighted fields.')` → `setError('Please fix the highlighted fields below.')`
(b) In `errs`, replace literals:
```tsx
    our_code: form.our_code.trim() ? '' : 'Enter the code.',
    invoice_date: form.invoice_date ? '' : 'Pick the invoice date.',
    hsn_code: form.hsn_code ? '' : 'Choose the HSN.',
    qty_kg: form.qty_kg > 0 ? '' : 'Enter a quantity.',
    rate_per_kg: form.rate_per_kg > 0 ? '' : 'Enter a rate per kg.',
    supplier_id: form.supplier_id ? '' : 'Choose a supplier.',
```
(Keep the existing `supplier_id` key; just ensure its message ends with a period. Do not re-add any removed `party*` rules.)
(c) Import `formatAddress`: `import { formatAddress } from '../lib/format'`. In the supplier read-only `Paper` block, replace the inline address join
`{[supplier.address, supplier.city, supplier.state].filter(Boolean).join(', ')}{supplier.pincode ? \` — ${supplier.pincode}\` : ''}`
with:
```tsx
            Address: {formatAddress(supplier)}
```
(`supplier` has `address/city/state/pincode`, matching `formatAddress`'s param shape.)

- [ ] **Step 6: `NewSale.tsx`** — formatAddress in the buyer block

Import `formatAddress` (`import { formatAddress } from '../lib/format'`). In the buyer
read-only block, replace the inline join
`{[buyer.billing_address, buyer.billing_city, buyer.billing_state].filter(Boolean).join(', ')}{buyer.billing_pincode ? \` — ${buyer.billing_pincode}\` : ''}`
with:
```tsx
              Address: {formatAddress({ address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode })}
```
(The other NewSale messages were already made plain in sub-project B — leave them.)

- [ ] **Step 7: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green, pristine (no unused imports). Manual check (deferred to operator):
a customer/supplier form with an empty city shows "Enter the city."; a bad GSTIN shows
the shared GSTIN message identically on both forms; the sale buyer block and purchase
supplier block render `address, city, state — pincode`.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/screens/FirstRun.tsx src/renderer/screens/CustomerForm.tsx src/renderer/screens/SupplierForm.tsx src/renderer/screens/PurchaseForm.tsx src/renderer/screens/NewSale.tsx src/renderer/screens/StockAdjust.tsx
git commit -m "refactor: plain-English form messages; VMSG + formatAddress in screens"
```

---

## Notes for the implementer

- The spec's §4 table is authoritative; if you find a stray user-facing `Required` or a
  technical message not listed (e.g. a `setError(...)` added since), apply the same
  plain-English, field-specific treatment and note it in your report.
- `formatAddress` is used ONLY on-screen (NewSale buyer block, PurchaseForm supplier
  block). Do NOT touch `InvoiceTemplate`'s `addr()` — its print format differs and print
  fidelity is preserved.
- No logic changes: validation rules, tax, numbering, and draw-down are untouched; only
  the human-readable strings move.
- Watch apostrophes in core messages (`You've`, `can't`, `couldn't`) — prefer template
  literals to avoid escaping.
