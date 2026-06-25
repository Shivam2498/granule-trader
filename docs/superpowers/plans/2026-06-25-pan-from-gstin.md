# PAN from GSTIN + Customer Phone Mandatory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-derive PAN from the GSTIN (read-only) for customers and the seller, and make the customer phone mandatory.

**Architecture:** Add a pure `panFromGstin(gstin)` helper to `@shared/validation`; wire it into the GSTIN onChange of the customer form, onboarding, and Settings so the PAN field auto-fills and is shown `disabled`. No schema change. Presentation/validation only.

**Tech Stack:** React 18, TypeScript, Mantine v7, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-pan-from-gstin-design.md` is authoritative.
- **PAN = `gstin.slice(2, 12)`** (chars 3–12), derived once the GSTIN is ≥12 chars, uppercased; read-only/`disabled` (greyed) everywhere it appears.
- **Customer phone mandatory:** 10-digit, inline error, blocks Save.
- No DB/schema change (PAN columns already exist; populated from the derived value).
- Renderer reaches data only via `window.api.*`. Build stays green each task (`npm test` + `npm run typecheck` + `npm run build`). Do NOT run `npm run dev` headless.

---

## File Structure

- `src/shared/validation.ts` — add `panFromGstin`.
- `tests/shared/validation.test.ts` — add its test.
- `src/renderer/screens/CustomerForm.tsx` — PAN derived+disabled; phone mandatory.
- `src/renderer/screens/FirstRun.tsx` — PAN derived+disabled (replace the manual PAN field).
- `src/renderer/screens/Settings.tsx` — seller PAN derived+disabled.

---

## Task 1: `panFromGstin` helper

**Files:**
- Modify: `src/shared/validation.ts`
- Test: `tests/shared/validation.test.ts`

**Interfaces:**
- Produces: `panFromGstin(gstin: string): string` — chars 3–12 of an uppercased GSTIN when length ≥ 12, else `''`. Consumed by the three forms in Task 2.

- [ ] **Step 1: Write the failing test** (append to `tests/shared/validation.test.ts`)

```ts
import { panFromGstin, isPan } from '../../src/shared/validation'

describe('panFromGstin', () => {
  it('extracts the PAN (chars 3-12) from a valid GSTIN', () => {
    expect(panFromGstin('24CCGPC8555A1Z5')).toBe('CCGPC8555A')
    expect(isPan(panFromGstin('24CCGPC8555A1Z5'))).toBe(true)   // a valid GSTIN yields a valid PAN
  })
  it('uppercases and derives once 12+ chars are present', () => {
    expect(panFromGstin('24ccgpc8555a')).toBe('CCGPC8555A')
  })
  it('returns empty for a too-short GSTIN', () => {
    expect(panFromGstin('24CCGPC')).toBe('')
    expect(panFromGstin('')).toBe('')
  })
})
```
(`validation.test.ts` already imports `isGstin/isPan/isMobile/isPincode/deriveInvoicePrefix`; add `panFromGstin` + `isPan` to that import if not already present, or use the new dedicated import line shown above.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/shared/validation.test.ts`
Expected: FAIL — `panFromGstin` not exported.

- [ ] **Step 3: Implement** (add to `src/shared/validation.ts`)

```ts
export function panFromGstin(gstin: string): string {
  const g = gstin.trim().toUpperCase()
  return g.length >= 12 ? g.slice(2, 12) : ''
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/shared/validation.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/shared/validation.ts tests/shared/validation.test.ts
git commit -m "feat: panFromGstin helper (PAN = GSTIN chars 3-12)"
```

---

## Task 2: Wire PAN-derive into the three forms + customer phone mandatory

**Files:**
- Modify: `src/renderer/screens/CustomerForm.tsx`, `src/renderer/screens/FirstRun.tsx`, `src/renderer/screens/Settings.tsx`
- Test: none (verify via typecheck + suite + build)

**Interfaces:**
- Consumes: `panFromGstin` from `@shared/validation`.

- [ ] **Step 1: CustomerForm** (`src/renderer/screens/CustomerForm.tsx`)

(a) Add `panFromGstin` to the `@shared/validation` import.
(b) In the `errs` object, **remove the `pan` entry** (PAN is derived, always valid when GSTIN is valid) and change `phone` to required:
```ts
    phone: isMobile(form.phone) ? '' : 'Enter a 10-digit phone number',
```
(c) Change the GSTIN `TextInput` onChange to also set the derived PAN, and add `withAsterisk`:
```tsx
        <TextInput label="GSTIN" withAsterisk value={form.gstin}
          onChange={e => set({ gstin: e.currentTarget.value.toUpperCase(), pan: panFromGstin(e.currentTarget.value) })}
          error={errs.gstin} />
```
(d) Change the PAN `TextInput` to disabled (derived, no onChange/error):
```tsx
        <TextInput label="PAN (from GSTIN)" disabled value={form.pan} />
```
(e) Add `withAsterisk` to the Name and Phone fields:
```tsx
        <TextInput label="Name" withAsterisk value={form.name} onChange={e => set({ name: e.currentTarget.value })} error={errs.name} />
        ...
        <TextInput label="Phone" withAsterisk value={form.phone} onChange={e => set({ phone: e.currentTarget.value.replace(/\D/g, '').slice(0,10) })} error={errs.phone} />
```
(f) In `save()`, the payload already spreads `form` (so `pan` is the derived value); leave `gstin: form.gstin.toUpperCase()` and change `pan: form.pan.toUpperCase()` to just rely on the spread (or keep — it's idempotent on an already-uppercased derived PAN). No other change.

- [ ] **Step 2: FirstRun (onboarding)** (`src/renderer/screens/FirstRun.tsx`)

(a) Add `panFromGstin` to the `@shared/validation` import.
(b) Change the GSTIN `TextInput` onChange to set both gstin and the derived pan:
```tsx
          <TextInput
            label="GSTIN"
            withAsterisk
            value={gstin}
            onChange={e => { setGstin(e.currentTarget.value.toUpperCase()); setPan(panFromGstin(e.currentTarget.value)) }}
            placeholder="24ABCDE1234F1Z5"
            error={gstin.length > 0 && !isGstin(gstin) ? 'GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5' : reqErr(gstin)}
          />
```
(c) Replace the manual PAN `TextInput` (the one with `onChange={e => setPan(...)}` and `error=...`) with a disabled derived display:
```tsx
          <TextInput label="PAN (from GSTIN)" disabled value={pan} placeholder="from GSTIN" />
```
The `valid` gate keeps `isPan(pan)` — now satisfied automatically once the GSTIN is valid.

- [ ] **Step 3: Settings** (`src/renderer/screens/Settings.tsx`)

(a) Add `panFromGstin` to the `@shared/validation` import (Settings already imports from there for state list? if not, add `import { panFromGstin } from '@shared/validation'`).
(b) Change the seller GSTIN field onChange to set the derived PAN, and make the PAN field disabled:
```tsx
          <TextInput label="GSTIN" value={s.seller_gstin}
            onChange={e => set({ seller_gstin: e.currentTarget.value.toUpperCase(), seller_pan: panFromGstin(e.currentTarget.value) })} />
          <TextInput label="PAN (from GSTIN)" disabled value={s.seller_pan} />
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. (Manual check, deferred to operator: typing a GSTIN auto-fills the greyed PAN in all three places; customer Save is blocked until phone is a 10-digit number.)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/screens/CustomerForm.tsx src/renderer/screens/FirstRun.tsx src/renderer/screens/Settings.tsx
git commit -m "feat: PAN auto-derived from GSTIN (read-only) in customer/onboarding/settings; customer phone mandatory"
```

---

## Notes for the implementer

- PAN is never typed now — it's derived from the GSTIN and shown `disabled` (greyed). It is stored as before (the `pan`/`seller_pan` columns already exist).
- A valid 15-char GSTIN always yields an `isPan`-valid PAN, so no separate PAN validation is needed; the customer form drops its `pan` error entry.
- Customer phone is now required (10-digit) and gates Save via the existing `errs`/`valid` map.
- Editing an existing customer loads its stored `pan`; changing the GSTIN re-derives it. The seller's stored `seller_pan` loads in Settings and re-derives if the GSTIN is edited.
