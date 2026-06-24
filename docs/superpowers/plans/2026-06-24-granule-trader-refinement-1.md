# Granule Trader — Refinement Round 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refine the shipped v1 Granule Trader app: complete mandatory onboarding, route-based list/form separation, customer validation + offline pincode location, clear live 3-box GST display, a multi-HSN sale flow, a dedicated stock-adjustment screen, per-sale invoice preview, and a cleaner overall UI.

**Architecture:** Same 3-layer Electron app (SQLite/`better-sqlite3` storage + pure-TS core in main + React renderer via `window.api`). New pure logic lives in `src/shared/*` (imported directly by both renderer and main — single source of truth, no IPC, fully unit-tested). Pincode lookup is renderer-side static data. The data model moves HSN from the sale to each allocation line.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, better-sqlite3, React Router, Vitest, @testing-library/react, an offline India pincode npm package.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-24-granule-trader-refinement-1-design.md` is authoritative.
- **Layering:** renderer reaches DB only via `window.api.*`. Pure, non-DB logic (validation, tax math, state list) lives in `src/shared/*` and is imported directly by both sides. Pincode lookup is renderer-only static data (no IPC).
- **Build stays green every task:** after each task, `npm test` + `npm run typecheck` + `npm run build` all pass. Dropping `sales.hsn_code` and changing the `SaleAllocation`/`NewSale` shapes is done together with their consumers in one task so nothing breaks mid-stream.
- **Money:** all monetary values via `round2` (2-dp). Quantities in kg.
- **Tax rule:** place of supply (buyer/supplier state vs home state, case-insensitive+trimmed) → equal: CGST 9% + SGST 9%, IGST 0%; not equal: IGST = full HSN rate, CGST/SGST 0%. Never both. Multi-HSN sales compute per HSN rate-group then sum.
- **Formats:** GSTIN `^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$` (15 char); PAN `^[A-Z]{5}[0-9]{4}[A-Z]$` (10 char); mobile `^[0-9]{10}$`; pincode `^[0-9]{6}$`. Invoice prefix auto-derived from business-name initials, editable.
- **Theme:** light only; explicit white input backgrounds + dark text; ~18px base, big targets; one primary action per page; calm spacing.
- **TDD:** failing test first (where a test applies), watch it fail, implement, watch it pass, commit. UI-only screens (no unit test in the task) verify via `npm run typecheck` + the suite staying green; the implementer must NOT run `npm run dev` (the GUI window will not exit headless).
- **Existing tests:** the v1 suite (65 tests) must keep passing; update tests that depend on changed shapes.

---

## File Structure

**New shared (pure, imported by both renderer + main):**
- `src/shared/money.ts` — `round2` (canonical; `main/core/money.ts` re-exports it)
- `src/shared/validation.ts` — `isGstin`, `isPan`, `isMobile`, `isPincode`, `deriveInvoicePrefix`
- `src/shared/indian-states.ts` — `INDIAN_STATES: string[]`
- `src/shared/tax.ts` — `computeTax` (single-rate, for purchases) + `computeSaleTax` (multi-rate, for sales); `main/core/tax.ts` re-exports `computeTax`

**New renderer:**
- `src/renderer/lib/pincode.ts` — `lookupPincode(pin)` (offline package)
- `src/renderer/components/`: `PageHeader.tsx`, `FormPage.tsx`, `FormSection.tsx`, `StateSelect.tsx`, `SignedMoneyInput.tsx`, `PincodeField.tsx`
- Screens split into list + form pages (see routes in tasks)

**Modified:**
- `src/main/db/schema.ts`, `src/shared/types.ts`, `src/main/core/reference.ts` (seller_phone)
- `src/main/core/sale.ts` (per-line HSN + `computeSaleTax`)
- `src/main/core/adjustment.ts` (+ `listAdjustments`, `deleteAdjustment`)
- `src/main/ipc.ts`, `src/shared/api.ts` (+ adjustment channels)
- `src/renderer/routes.tsx`, `src/renderer/theme.css`, and every screen + `FirstRun.tsx`, `InvoiceTemplate.tsx`

---

## Phase A — Shared pure foundations

### Task 1: Shared money, validation, and Indian-states list

**Files:**
- Create: `src/shared/money.ts`, `src/shared/validation.ts`, `src/shared/indian-states.ts`
- Modify: `src/main/core/money.ts` (re-export)
- Test: `tests/shared/validation.test.ts`

**Interfaces:**
- Produces: `round2(n)` (canonical in shared); `isGstin(s)`, `isPan(s)`, `isMobile(s)`, `isPincode(s)` → boolean; `deriveInvoicePrefix(name): string`; `INDIAN_STATES: string[]`.
- Consumed by: validators + prefix used by onboarding/customer forms (Tasks 8, 9); `INDIAN_STATES` by `StateSelect` (Task 7); `round2` by `src/shared/tax.ts` (Task 2).

- [ ] **Step 1: Write the failing test**

`tests/shared/validation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { isGstin, isPan, isMobile, isPincode, deriveInvoicePrefix } from '../../src/shared/validation'

describe('format validators', () => {
  it('accepts a valid GSTIN and rejects bad ones', () => {
    expect(isGstin('24ABCDE1234F1Z5')).toBe(true)
    expect(isGstin('24abcde1234f1z5')).toBe(false)   // lowercase
    expect(isGstin('24ABCDE1234F1Z')).toBe(false)    // 14 chars
  })
  it('validates PAN', () => {
    expect(isPan('ABCDE1234F')).toBe(true)
    expect(isPan('ABCDE1234')).toBe(false)
  })
  it('validates 10-digit mobile and 6-digit pincode', () => {
    expect(isMobile('9876543210')).toBe(true)
    expect(isMobile('98765')).toBe(false)
    expect(isPincode('395003')).toBe(true)
    expect(isPincode('39500')).toBe(false)
  })
})

describe('deriveInvoicePrefix', () => {
  it('takes initials of significant words', () => {
    expect(deriveInvoicePrefix('Ramaxton Plastocrafts')).toBe('RP')
    expect(deriveInvoicePrefix('Shree Ram Traders')).toBe('SRT')
    expect(deriveInvoicePrefix('Ram and Sons & Co')).toBe('RSC')   // skip and/&
  })
  it('falls back to first two letters for a single word', () => {
    expect(deriveInvoicePrefix('Ramaxton')).toBe('RA')
  })
  it('returns empty for empty input', () => {
    expect(deriveInvoicePrefix('   ')).toBe('')
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/shared/validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/shared/money.ts`:
```ts
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
```

`src/main/core/money.ts` (replace entire file with a re-export so existing imports keep working):
```ts
export { round2 } from '@shared/money'
```

`src/shared/validation.ts`:
```ts
export function isGstin(s: string): boolean {
  return /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s.trim())
}
export function isPan(s: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(s.trim())
}
export function isMobile(s: string): boolean {
  return /^[0-9]{10}$/.test(s.trim())
}
export function isPincode(s: string): boolean {
  return /^[0-9]{6}$/.test(s.trim())
}

const PREFIX_SKIP = new Set(['and', 'the', 'of', '&'])

export function deriveInvoicePrefix(name: string): string {
  const words = name.trim().split(/\s+/).filter(w => w && !PREFIX_SKIP.has(w.toLowerCase()))
  if (words.length === 0) return ''
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return words.map(w => w[0].toUpperCase()).join('')
}
```

`src/shared/indian-states.ts`:
```ts
export const INDIAN_STATES: string[] = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa',
  'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala',
  'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland',
  'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura',
  'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry'
]
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/shared/validation.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + typecheck (the money re-export must not break v1)**

Run: `npm test && npm run typecheck`
Expected: all green (the v1 money tests still pass through the re-export).

- [ ] **Step 6: Commit**

```bash
git add src/shared/money.ts src/shared/validation.ts src/shared/indian-states.ts src/main/core/money.ts tests/shared/validation.test.ts
git commit -m "feat: shared money/validation/indian-states (round2 canonical in shared)"
```

---

### Task 2: Shared tax — `computeTax` + multi-rate `computeSaleTax`

**Files:**
- Create: `src/shared/tax.ts`
- Modify: `src/main/core/tax.ts` (re-export), `src/main/core/purchase.ts` + `src/main/core/sale.ts` import path stays valid (they import from `./tax` which re-exports)
- Test: `tests/shared/tax.test.ts`

**Interfaces:**
- Consumes: `round2` from `@shared/money`.
- Produces:
  - `computeTax(input: ComputeTaxInput): TaxResult` — unchanged behaviour (single rate, for purchases). `ComputeTaxInput = { amount, gstRate, placeOfSupplyState, homeState, tcs?, roundoff? }`.
  - `computeSaleTax(input: ComputeSaleTaxInput): SaleTaxResult` where
    ```ts
    interface SaleTaxLine { qty_drawn_kg: number; rate_per_kg: number; gst_rate: number }
    interface ComputeSaleTaxInput { lines: SaleTaxLine[]; placeOfSupplyState: string; homeState: string; roundoff?: number }
    interface SaleTaxResult { taxable: number; cgst: number; sgst: number; igst: number; roundoff: number; total: number; totalQty: number }
    ```
    Groups lines by `gst_rate`; per group amount `A` at rate `r`: intra → cgst/sgst += round2(A·r/2/100); inter → igst += round2(A·r/100). `taxable = round2(Σ line_amount)`, `total = round2(taxable + cgst + sgst + igst + roundoff)`. No TCS.
- Consumed by: `sale.ts` storage (Task 4) and the New Sale live preview (Task 11) — same function both sides.

- [ ] **Step 1: Write the failing test**

`tests/shared/tax.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeTax, computeSaleTax } from '../../src/shared/tax'

describe('computeTax (purchases, single rate)', () => {
  it('intra-state splits CGST+SGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Gujarat', homeState: 'Gujarat' })
    expect(r).toMatchObject({ cgst: 90, sgst: 90, igst: 0, total: 1180 })
  })
  it('inter-state applies IGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Maharashtra', homeState: 'Gujarat' })
    expect(r).toMatchObject({ igst: 180, cgst: 0, sgst: 0, total: 1180 })
  })
})

describe('computeSaleTax (multi-rate)', () => {
  const homeState = 'Gujarat'
  it('single rate intra-state', () => {
    const r = computeSaleTax({ lines: [
      { qty_drawn_kg: 600, rate_per_kg: 80, gst_rate: 18 },
      { qty_drawn_kg: 400, rate_per_kg: 90, gst_rate: 18 }
    ], placeOfSupplyState: 'Gujarat', homeState })
    expect(r.taxable).toBe(84000)
    expect(r.cgst).toBe(7560); expect(r.sgst).toBe(7560); expect(r.igst).toBe(0)
    expect(r.total).toBe(99120); expect(r.totalQty).toBe(1000)
  })
  it('mixed rates intra-state sum per group', () => {
    const r = computeSaleTax({ lines: [
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 18 },  // 10000 @18 -> cgst/sgst 900 each
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 5 }    // 10000 @5  -> cgst/sgst 250 each
    ], placeOfSupplyState: 'Gujarat', homeState })
    expect(r.taxable).toBe(20000)
    expect(r.cgst).toBe(1150); expect(r.sgst).toBe(1150); expect(r.igst).toBe(0)
    expect(r.total).toBe(22300)
  })
  it('inter-state uses IGST per group', () => {
    const r = computeSaleTax({ lines: [
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 18 },
      { qty_drawn_kg: 100, rate_per_kg: 100, gst_rate: 5 }
    ], placeOfSupplyState: 'Maharashtra', homeState })
    expect(r.cgst).toBe(0); expect(r.sgst).toBe(0)
    expect(r.igst).toBe(2300); expect(r.total).toBe(22300)
  })
  it('applies a negative round-off', () => {
    const r = computeSaleTax({ lines: [{ qty_drawn_kg: 10, rate_per_kg: 100, gst_rate: 18 }],
      placeOfSupplyState: 'Gujarat', homeState, roundoff: -0.40 })
    // taxable 1000, cgst 90, sgst 90 -> 1180 - 0.40 = 1179.60
    expect(r.total).toBe(1179.6)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/shared/tax.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/shared/tax.ts`**

```ts
import { round2 } from './money'
import type { TaxResult } from './types'

export interface ComputeTaxInput {
  amount: number; gstRate: number
  placeOfSupplyState: string; homeState: string
  tcs?: number; roundoff?: number
}

function isIntra(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function computeTax(input: ComputeTaxInput): TaxResult {
  const { amount, gstRate } = input
  const tcs = input.tcs ?? 0
  const roundoff = input.roundoff ?? 0
  const intra = isIntra(input.placeOfSupplyState, input.homeState)
  const cgst = intra ? round2((amount * gstRate) / 2 / 100) : 0
  const sgst = cgst
  const igst = intra ? 0 : round2((amount * gstRate) / 100)
  const total = round2(amount + cgst + sgst + igst + tcs + roundoff)
  return { taxable_amount: round2(amount), cgst, sgst, igst, tcs: round2(tcs), roundoff: round2(roundoff), total }
}

export interface SaleTaxLine { qty_drawn_kg: number; rate_per_kg: number; gst_rate: number }
export interface ComputeSaleTaxInput {
  lines: SaleTaxLine[]; placeOfSupplyState: string; homeState: string; roundoff?: number
}
export interface SaleTaxResult {
  taxable: number; cgst: number; sgst: number; igst: number; roundoff: number; total: number; totalQty: number
}

export function computeSaleTax(input: ComputeSaleTaxInput): SaleTaxResult {
  const roundoff = input.roundoff ?? 0
  const intra = isIntra(input.placeOfSupplyState, input.homeState)
  const byRate = new Map<number, number>()   // gst_rate -> summed amount
  let taxable = 0, totalQty = 0
  for (const l of input.lines) {
    const lineAmount = round2(l.qty_drawn_kg * l.rate_per_kg)
    taxable = round2(taxable + lineAmount)
    totalQty = round2(totalQty + l.qty_drawn_kg)
    byRate.set(l.gst_rate, round2((byRate.get(l.gst_rate) ?? 0) + lineAmount))
  }
  let cgst = 0, sgst = 0, igst = 0
  for (const [rate, amount] of byRate) {
    if (intra) { cgst = round2(cgst + round2((amount * rate) / 2 / 100)); sgst = cgst }
    else { igst = round2(igst + round2((amount * rate) / 100)) }
  }
  const total = round2(taxable + cgst + sgst + igst + roundoff)
  return { taxable, cgst, sgst, igst, roundoff: round2(roundoff), total, totalQty }
}
```

> Note: `@shared/tax` imports `./types` and `./money` — both in `src/shared`. The `TaxResult` type already lives in `src/shared/types.ts`.

`src/main/core/tax.ts` (replace entire file with a re-export; existing importers of `./tax` keep working):
```ts
export { computeTax } from '@shared/tax'
export type { ComputeTaxInput } from '@shared/tax'
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/shared/tax.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: all green (v1 tax test still passes via the re-export; purchase/sale still import `computeTax` from `./tax`).

- [ ] **Step 6: Commit**

```bash
git add src/shared/tax.ts src/main/core/tax.ts tests/shared/tax.test.ts
git commit -m "feat: shared tax module + multi-rate computeSaleTax"
```

---

### Task 3: Offline pincode lookup

**Files:**
- Create: `src/renderer/lib/pincode.ts`
- Modify: `package.json` (add the offline pincode dependency)
- Test: `tests/renderer/pincode.test.ts`

**Interfaces:**
- Produces: `lookupPincode(pin: string): { city: string; state: string } | null` — returns the first matching record's city (district/taluk) + state for a 6-digit pincode, or `null` if unknown/invalid. Renderer-only (bundled static data; no IPC).
- Consumed by: `PincodeField` (Task 7).

- [ ] **Step 1: Add the dependency**

Run: `npm install india-pincode-lookup`
(If `india-pincode-lookup` is unavailable or unusable in Node tests, STOP and report — the fallback is bundling a compact `pincode→{city,state}` JSON under `src/renderer/data/` and reading it; do not invent an API call.)

Verify it loads in Node:
Run: `node -e "const p=require('india-pincode-lookup'); console.log(p.lookup('395003')[0])"`
Expected: prints a record object containing a state name (e.g. `stateName: 'GUJARAT'`) and an office/district name. Note the exact field names it returns — you'll map them in Step 3.

- [ ] **Step 2: Write the failing test**

`tests/renderer/pincode.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { lookupPincode } from '../../src/renderer/lib/pincode'

describe('lookupPincode', () => {
  it('returns city + state for a known pincode', () => {
    const r = lookupPincode('395003')   // Surat, Gujarat
    expect(r).not.toBeNull()
    expect(r!.state.toLowerCase()).toContain('gujarat')
    expect(r!.city.length).toBeGreaterThan(0)
  })
  it('returns null for an invalid or unknown pincode', () => {
    expect(lookupPincode('abc')).toBeNull()
    expect(lookupPincode('000000')).toBeNull()
  })
})
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run tests/renderer/pincode.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement `src/renderer/lib/pincode.ts`**

```ts
import { isPincode } from '@shared/validation'
import * as pin from 'india-pincode-lookup'

// Map the package's record fields to a normalized, title-cased {city, state}.
// Adjust the field names below to match what Step 1 printed (e.g. districtName/taluk/stateName).
function title(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, c => c.toUpperCase()).trim()
}

export function lookupPincode(pincode: string): { city: string; state: string } | null {
  if (!isPincode(pincode)) return null
  const records = (pin as any).lookup(pincode) as Array<Record<string, string>>
  if (!records || records.length === 0) return null
  const rec = records[0]
  const state = rec.stateName ?? rec.state ?? ''
  const city = rec.districtName ?? rec.taluk ?? rec.officeName ?? ''
  if (!state) return null
  return { city: title(city), state: title(state) }
}
```

> The exact `rec.*` keys come from Step 1's output. If the state comes back uppercase like `GUJARAT`, `title()` normalizes it to `Gujarat` so it matches `INDIAN_STATES` and the home-state comparison in tax.

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run tests/renderer/pincode.test.ts`
Expected: PASS (2 tests). If the returned state title-case doesn't equal an `INDIAN_STATES` entry exactly (e.g. "Andaman And Nicobar..."), add a small normalization map in `pincode.ts` for those few cases and note it.

- [ ] **Step 6: Full suite + build (the new dep must bundle in the renderer)**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green; renderer bundle builds with the dependency included.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/lib/pincode.ts tests/renderer/pincode.test.ts
git commit -m "feat: offline pincode -> city/state lookup"
```

---

## Phase B — Data model, sale logic, adjustments, IPC

### Task 4: Multi-HSN data model + sale logic (build-green integration)

**Files:**
- Modify: `src/main/db/schema.ts`, `src/shared/types.ts`, `src/main/core/reference.ts`, `src/main/core/sale.ts`, `src/renderer/invoice/InvoiceTemplate.tsx`, `src/renderer/screens/NewSale.tsx`
- Test: update `tests/core/sale.test.ts`, `tests/renderer/invoice-template.test.tsx`, `tests/integration/sale-to-invoice.test.tsx`

**Interfaces:**
- Consumes: `computeSaleTax` (`@shared/tax`).
- Produces (new shapes):
  - `SaleAllocation` gains `hsn_code: string` and `gst_rate: number`.
  - `Sale` loses `hsn_code` (HSN now per allocation).
  - `Settings` gains `seller_phone: string`.
  - `NewSaleLine = { purchase_id: number; qty_drawn_kg: number; rate_per_kg: number; hsn_code: string; gst_rate: number }`.
  - `NewSale` loses `hsn_code`, `gst_rate`, `tcs`; keeps `place_of_supply_state`, `homeState`, `lines`, `roundoff?`, buyer fields, eway/vehicle, payment.

> This task changes the data model AND every consumer in one go so the build/tests stay green. The New Sale screen and invoice get only the **minimal data-wiring changes** here; their full visual redesign is Tasks 11 and 14.

- [ ] **Step 1: Update the schema** (`src/main/db/schema.ts`)

In the `sales` table, **delete** the line `  hsn_code TEXT NOT NULL DEFAULT '',`.
In the `sale_allocations` table, add two columns so it reads:
```sql
CREATE TABLE IF NOT EXISTS sale_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  hsn_code TEXT NOT NULL DEFAULT '',
  gst_rate REAL NOT NULL DEFAULT 0,
  qty_drawn_kg REAL NOT NULL,
  rate_per_kg REAL NOT NULL,
  line_amount REAL NOT NULL
);
```

- [ ] **Step 2: Update types** (`src/shared/types.ts`)

In `SaleAllocation`, add after `purchase_id`:
```ts
  hsn_code: string
  gst_rate: number
```
In `Sale`, **remove** the line `  hsn_code: string`.
In `Settings`, add after `seller_pan`:
```ts
  seller_phone: string
```

- [ ] **Step 3: Update DEFAULT_SETTINGS** (`src/main/core/reference.ts`)

Change the `DEFAULT_SETTINGS` object to include `seller_phone: ''`:
```ts
export const DEFAULT_SETTINGS: Settings = {
  seller_name: '', seller_address: '', seller_gstin: '', seller_pan: '', seller_phone: '', home_state: '',
  invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10
}
```

- [ ] **Step 4: Replace `src/main/core/sale.ts`** with the multi-HSN version

```ts
import type Database from 'better-sqlite3'
import type { Sale, SaleAllocation } from '@shared/types'
import { computeSaleTax } from '@shared/tax'
import { round2 } from '@shared/money'
import { parseInvoiceNumber } from './invoice-number'
import { reserveGaps, validateInvoiceOrder } from './invoice-validation'
import { listAvailableLots } from './available-lots'

export interface NewSaleLine {
  purchase_id: number; qty_drawn_kg: number; rate_per_kg: number; hsn_code: string; gst_rate: number
}
export interface NewSale {
  invoice_number: string; invoice_date: string
  buyer_customer_id: number | null; buyer_name: string; buyer_gstin: string
  buyer_billing: object; buyer_shipping: object; place_of_supply_state: string
  homeState: string
  lines: NewSaleLine[]; roundoff?: number
  eway_bill_no?: string; eway_bill_date?: string; vehicle?: string
  payment_status?: 'pending' | 'done'; payment_date?: string | null
}

export function getSale(db: Database.Database, id: number): Sale {
  return db.prepare('SELECT * FROM sales WHERE id = ?').get(id) as Sale
}
export function getAllocations(db: Database.Database, saleId: number): SaleAllocation[] {
  return db.prepare('SELECT * FROM sale_allocations WHERE sale_id = ? ORDER BY id').all(saleId) as SaleAllocation[]
}
export function listSales(db: Database.Database): Sale[] {
  return db.prepare(`SELECT * FROM sales ORDER BY fy_label DESC, seq DESC`).all() as Sale[]
}

function writeSale(db: Database.Database, input: NewSale, existingReservedId: number | null): Sale {
  const parsed = parseInvoiceNumber(input.invoice_number)
  if (!parsed) throw new Error(`Invoice number must look like RP/008/2024-25 (got "${input.invoice_number}")`)
  const { prefix, seq, fyLabel } = parsed

  const order = validateInvoiceOrder(db, { fyLabel, seq, invoiceDate: input.invoice_date, excludeSaleId: existingReservedId ?? undefined })
  if (!order.ok) throw new Error(order.message)

  const avail = new Map(listAvailableLots(db, input.invoice_date, { excludeSaleId: existingReservedId ?? undefined })
    .map(l => [l.purchase_id, l]))
  for (const line of input.lines) {
    const lot = avail.get(line.purchase_id)
    const have = lot?.available_kg ?? 0
    if (round2(line.qty_drawn_kg) > have)
      throw new Error(`Lot ${lot?.our_code ?? line.purchase_id} only has ${have} kg left as of ${input.invoice_date}`)
  }

  const tax = computeSaleTax({
    lines: input.lines.map(l => ({ qty_drawn_kg: l.qty_drawn_kg, rate_per_kg: l.rate_per_kg, gst_rate: l.gst_rate })),
    placeOfSupplyState: input.place_of_supply_state, homeState: input.homeState, roundoff: input.roundoff
  })

  const maxBelow = db.prepare('SELECT MAX(seq) AS m FROM sales WHERE fy_label = ? AND seq < ?').get(fyLabel, seq) as { m: number | null }
  reserveGaps(db, prefix, fyLabel, maxBelow.m ?? 0, seq)

  const fields = {
    invoice_number: input.invoice_number, prefix, seq, fy_label: fyLabel, status: 'created',
    invoice_date: input.invoice_date, eway_bill_no: input.eway_bill_no ?? null,
    eway_bill_date: input.eway_bill_date ?? null, vehicle: input.vehicle ?? null,
    buyer_customer_id: input.buyer_customer_id, buyer_name: input.buyer_name, buyer_gstin: input.buyer_gstin,
    buyer_billing_json: JSON.stringify(input.buyer_billing), buyer_shipping_json: JSON.stringify(input.buyer_shipping),
    amount: tax.taxable, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst,
    tcs: 0, roundoff: tax.roundoff, total_invoice_amount: tax.total, total_qty_kg: tax.totalQty,
    payment_status: input.payment_status ?? 'pending', payment_date: input.payment_date ?? null
  }

  let saleId: number
  if (existingReservedId != null) {
    db.prepare(`UPDATE sales SET invoice_number=@invoice_number, prefix=@prefix, seq=@seq, fy_label=@fy_label,
      status=@status, invoice_date=@invoice_date, eway_bill_no=@eway_bill_no, eway_bill_date=@eway_bill_date,
      vehicle=@vehicle, buyer_customer_id=@buyer_customer_id, buyer_name=@buyer_name, buyer_gstin=@buyer_gstin,
      buyer_billing_json=@buyer_billing_json, buyer_shipping_json=@buyer_shipping_json,
      amount=@amount, cgst=@cgst, sgst=@sgst, igst=@igst, tcs=@tcs, roundoff=@roundoff,
      total_invoice_amount=@total_invoice_amount, total_qty_kg=@total_qty_kg, payment_status=@payment_status,
      payment_date=@payment_date WHERE id=@id`).run({ ...fields, id: existingReservedId })
    saleId = existingReservedId
    db.prepare('DELETE FROM sale_allocations WHERE sale_id = ?').run(saleId)
  } else {
    const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date,
      eway_bill_no, eway_bill_date, vehicle, buyer_customer_id, buyer_name, buyer_gstin, buyer_billing_json,
      buyer_shipping_json, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
      total_qty_kg, payment_status, payment_date)
      VALUES (@invoice_number, @prefix, @seq, @fy_label, @status, @invoice_date, @eway_bill_no, @eway_bill_date,
      @vehicle, @buyer_customer_id, @buyer_name, @buyer_gstin, @buyer_billing_json, @buyer_shipping_json,
      @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount, @total_qty_kg,
      @payment_status, @payment_date)`).run(fields)
    saleId = Number(info.lastInsertRowid)
  }

  const insAlloc = db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
  const dec = db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg - ?, 2) WHERE id = ?')
  for (const line of input.lines) {
    insAlloc.run(saleId, line.purchase_id, line.hsn_code, line.gst_rate, round2(line.qty_drawn_kg), round2(line.rate_per_kg), round2(line.qty_drawn_kg * line.rate_per_kg))
    dec.run(round2(line.qty_drawn_kg), line.purchase_id)
  }
  return getSale(db, saleId)
}

export function createSale(db: Database.Database, input: NewSale): Sale {
  const tx = db.transaction(() => {
    const parsed = parseInvoiceNumber(input.invoice_number)
    const reserved = parsed
      ? db.prepare(`SELECT id FROM sales WHERE fy_label = ? AND seq = ? AND status = 'reserved'`).get(parsed.fyLabel, parsed.seq) as { id: number } | undefined
      : undefined
    return writeSale(db, input, reserved?.id ?? null)
  })
  return tx()
}

export function fillReservedSale(db: Database.Database, saleId: number, input: NewSale): Sale {
  const tx = db.transaction(() => writeSale(db, input, saleId))
  return tx()
}

export function deleteSale(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    const allocs = getAllocations(db, id)
    const restore = db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg + ?, 2) WHERE id = ?')
    for (const a of allocs) restore.run(a.qty_drawn_kg, a.purchase_id)
    db.prepare('DELETE FROM sales WHERE id = ?').run(id)
  })
  tx()
}
```

- [ ] **Step 5: Minimal consumer edits to keep the build green**

`src/renderer/invoice/InvoiceTemplate.tsx`: in the line-items `<tbody>`, change the per-row HSN cell from `<td>{sale.hsn_code}</td>` to `<td>{a.hsn_code}</td>` (the allocation now carries its own HSN). Leave the rest as-is (full HSN-summary redesign is Task 14).

`src/renderer/screens/NewSale.tsx`: this screen is fully replaced in Task 11. For now, make it compile against the new `NewSale` shape with this minimal change to `save()`'s payload — build each line with its lot's HSN + rate and drop the sale-level `hsn_code`/`gst_rate`/`tcs`:
- Build a rate map once: `const hsnRate = new Map(hsn.map(h => [h.hsn_code, h.gst_rate]))`.
- Change the `lines` passed in the payload to:
  ```ts
  lines: lines.map(l => {
    const lot = lots.find(x => x.purchase_id === l.purchase_id)
    return { ...l, hsn_code: lot?.hsn_code ?? '', gst_rate: hsnRate.get(lot?.hsn_code ?? '') ?? settings!.default_gst_rate }
  }),
  ```
- Remove `hsn_code: hsnCode`, `gst_rate: gstRate`, and `tcs` from the payload object. (The HSN dropdown UI can remain unused for now; Task 11 removes it.)

- [ ] **Step 6: Update the affected tests to the new shapes**

`tests/core/sale.test.ts`: the `sbase` object — remove `hsn_code` and `gst_rate`; lines now include `hsn_code` + `gst_rate`. Update the helper so each line carries them, e.g.:
```ts
const sbase = {
  buyer_customer_id: null, buyer_name: 'Buyer', buyer_gstin: '',
  buyer_billing: {}, buyer_shipping: {}, place_of_supply_state: 'Gujarat', homeState: 'Gujarat'
}
function line(purchase_id: number, qty: number, rate: number) {
  return { purchase_id, qty_drawn_kg: qty, rate_per_kg: rate, hsn_code: '3902', gst_rate: 18 }
}
```
Update each test's `lines: [...]` to use `line(a.id, 600, 80)` etc. Keep all existing assertions (amount/cgst/remaining/rollback/reservation/fill/delete). Add one assertion that the stored allocation carries HSN:
```ts
it('stores HSN + gst_rate on each allocation', () => {
  const a = lot('0001/2425', '2024-05-01', 1000)
  const s = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10', lines: [line(a.id, 100, 80)] })
  const allocs = getAllocations(db, s.id)
  expect(allocs[0].hsn_code).toBe('3902')
  expect(allocs[0].gst_rate).toBe(18)
})
```
(Import `getAllocations` from `../../src/main/core/sale`.)

`tests/renderer/invoice-template.test.tsx` and `tests/integration/sale-to-invoice.test.tsx`: remove `hsn_code` from the `sale`/`Sale` fixtures and add `hsn_code: '3902'`, `gst_rate: 18` to the allocation fixtures. The template now reads `a.hsn_code`, so the `3902` assertion (if any) still holds.

- [ ] **Step 7: Update the schema test**

`tests/db/schema.test.ts`: it checks table existence (still fine). Add a column check for the new allocation columns:
```ts
it('sale_allocations carries hsn_code and gst_rate', () => {
  const db = openDatabase(':memory:')
  const cols = db.prepare("PRAGMA table_info(sale_allocations)").all().map((r: any) => r.name)
  expect(cols).toContain('hsn_code'); expect(cols).toContain('gst_rate')
  db.close()
})
```

- [ ] **Step 8: Run everything**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green. If a stale dev `.db` exists in a data folder, it is safe to delete (no real data) — the schema is recreated with the new columns.

- [ ] **Step 9: Commit**

```bash
git add src/main/db/schema.ts src/shared/types.ts src/main/core/reference.ts src/main/core/sale.ts src/renderer/invoice/InvoiceTemplate.tsx src/renderer/screens/NewSale.tsx tests/core/sale.test.ts tests/renderer/invoice-template.test.tsx tests/integration/sale-to-invoice.test.tsx tests/db/schema.test.ts
git commit -m "feat: multi-HSN sale model (per-line HSN+rate, computeSaleTax, drop sale HSN/TCS)"
```

---

### Task 5: Stock-adjustment list + undo (core)

**Files:**
- Modify: `src/main/core/adjustment.ts`
- Test: update `tests/core/adjustment.test.ts`

**Interfaces:**
- Consumes: `round2`.
- Produces:
  - `listAdjustments(db, limit = 50): AdjustmentRow[]` where `AdjustmentRow = { id, purchase_id, our_code, qty_kg, reason, date }` (joined to the lot's code), newest first.
  - `deleteAdjustment(db, id): void` — one transaction: restore `qty_kg` to the lot's `qty_remaining_kg`, then delete the adjustment row.

- [ ] **Step 1: Write the failing test** (append to `tests/core/adjustment.test.ts`)

```ts
import { listAdjustments, deleteAdjustment } from '../../src/main/core/adjustment'

describe('listAdjustments + deleteAdjustment (undo)', () => {
  it('lists newest first and undo restores the lot', () => {
    const p = createPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_id: p.id, qty_kg: 200, reason: 'spillage', date: '2024-05-05' })
    const rows = listAdjustments(db)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ our_code: '0001/2425', qty_kg: 200, reason: 'spillage' })
    deleteAdjustment(db, rows[0].id)
    expect(getPurchase(db, p.id)!.qty_remaining_kg).toBe(1000)   // restored
    expect(listAdjustments(db)).toHaveLength(0)
  })
})
```
(Ensure `getPurchase` and `createPurchase` are imported in this test file — they already are from the v1 test.)

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/adjustment.test.ts`
Expected: FAIL — `listAdjustments`/`deleteAdjustment` not exported.

- [ ] **Step 3: Implement** (append to `src/main/core/adjustment.ts`)

```ts
export interface AdjustmentRow {
  id: number; purchase_id: number; our_code: string; qty_kg: number; reason: string; date: string
}

export function listAdjustments(db: Database.Database, limit = 50): AdjustmentRow[] {
  return db.prepare(`
    SELECT a.id, a.purchase_id, p.our_code, a.qty_kg, a.reason, a.date
    FROM stock_adjustments a JOIN purchases p ON p.id = a.purchase_id
    ORDER BY a.id DESC LIMIT ?
  `).all(limit) as AdjustmentRow[]
}

export function deleteAdjustment(db: Database.Database, id: number): void {
  const tx = db.transaction(() => {
    const adj = db.prepare('SELECT purchase_id, qty_kg FROM stock_adjustments WHERE id = ?').get(id) as { purchase_id: number; qty_kg: number } | undefined
    if (!adj) return
    db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg + ?, 2) WHERE id = ?').run(round2(adj.qty_kg), adj.purchase_id)
    db.prepare('DELETE FROM stock_adjustments WHERE id = ?').run(id)
  })
  tx()
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/adjustment.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/adjustment.ts tests/core/adjustment.test.ts
git commit -m "feat: stock adjustment list + transactional undo"
```

---

### Task 6: IPC + preload — adjustment channels

**Files:**
- Modify: `src/shared/api.ts`, `src/main/ipc.ts`
- Test: update `tests/core/api-shape.test.ts`

**Interfaces:**
- Consumes: `listAdjustments`, `deleteAdjustment`.
- Produces (new `Api` methods + channels): `listAdjustments(): Promise<AdjustmentRow[]>`, `deleteAdjustment(id: number): Promise<void>`.

- [ ] **Step 1: Extend the contract** (`src/shared/api.ts`)

Add the import `import type { AdjustmentRow } from '../main/core/adjustment'` (type-only). In the `Api` interface, under `// stock`, add:
```ts
  listAdjustments(): Promise<AdjustmentRow[]>
  deleteAdjustment(id: number): Promise<void>
```
In `CHANNELS`, add `'listAdjustments','deleteAdjustment'` to the stock group.

- [ ] **Step 2: Update the guard test** (`tests/core/api-shape.test.ts`)

Add `'listAdjustments','deleteAdjustment'` to the `API_METHODS` array.

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run tests/core/api-shape.test.ts`
Expected: FAIL — channels not yet registered.

- [ ] **Step 4: Register handlers** (`src/main/ipc.ts`)

Add to the imports: `import { stockLedger, createStockAdjustment, listAdjustments, deleteAdjustment } from './core/adjustment'` (extend the existing import). In `registerIpc`, under the stock handlers, add:
```ts
  h('listAdjustments', () => listAdjustments(db()))
  h('deleteAdjustment', (id) => deleteAdjustment(db(), id))
```

- [ ] **Step 5: Run test + typecheck + build**

Run: `npx vitest run tests/core/api-shape.test.ts && npm run typecheck && npm run build`
Expected: PASS; no type errors; build OK.

- [ ] **Step 6: Commit**

```bash
git add src/shared/api.ts src/main/ipc.ts tests/core/api-shape.test.ts
git commit -m "feat: IPC channels for stock-adjustment list + undo"
```

---

## Phase C — Theme + shared UI components

### Task 7: Cleaner theme + shared layout/form components

**Files:**
- Modify: `src/renderer/theme.css`
- Create: `src/renderer/components/PageHeader.tsx`, `FormPage.tsx`, `FormSection.tsx`, `StateSelect.tsx`, `SignedMoneyInput.tsx`, `PincodeField.tsx`
- Test: `tests/renderer/signed-money-input.test.tsx`, `tests/renderer/state-select.test.tsx`

**Interfaces:**
- Produces:
  - `PageHeader({ title, action?, back? })` — `action?: ReactNode` (right), `back?: () => void` (a `‹ Back` link).
  - `FormPage({ title, onBack, error?, footer, children })` — page shell with back + title + error banner + body + bottom-right `footer` actions.
  - `FormSection({ title, children })` — section heading + divider + a `.form-grid` 2-up grid.
  - `StateSelect({ value, onChange, id? })` — dropdown over `INDIAN_STATES`.
  - `SignedMoneyInput({ value, onChange, id? })` — numeric input allowing a leading `−`; empty → 0; reports a `number`.
  - `PincodeField({ value, onChange, onResolved, id? })` — pincode text input; on a valid 6-digit value calls `onResolved({ city, state })`.
- Consumed by: all redesigned screens (Tasks 8–14).

- [ ] **Step 1: Refresh `src/renderer/theme.css`** (replace entire file)

```css
:root {
  --bg: #f4f6f8; --surface: #ffffff; --text: #14181f; --muted: #5b6573;
  --accent: #1565c0; --accent-text: #ffffff; --border: #e2e7ee; --border-strong: #cdd5df;
  --danger: #c62828; --ok: #2e7d32; --warn: #b25e00; --warn-bg: #fff6e6;
  --sp: 8px;
  color-scheme: light;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 18px; line-height: 1.45; color: var(--text); background: var(--bg); }
h1 { font-size: 28px; margin: 0; } h2 { font-size: 21px; margin: 0; } h3 { font-size: 17px; margin: 0; color: var(--muted); }

input, select, textarea {
  width: 100%; font-size: 17px; padding: 11px 12px; border: 1px solid var(--border-strong);
  border-radius: 10px; background: #ffffff !important; color: #14181f !important;
}
input:focus, select:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: 0; border-color: var(--accent); }
button { font-size: 17px; padding: 11px 18px; border-radius: 10px; border: 1px solid var(--border-strong);
  background: var(--surface); color: var(--text); cursor: pointer; }
button:hover { border-color: var(--accent); }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); font-weight: 600; }
button.primary:hover { filter: brightness(1.05); }
button.link { border: none; background: none; color: var(--accent); padding: 6px 4px; }
button.danger { color: var(--danger); border-color: var(--border-strong); }
button:disabled { opacity: .5; cursor: not-allowed; }

.app { display: flex; min-height: 100vh; }
.sidebar { width: 230px; background: var(--surface); border-right: 1px solid var(--border); padding: 16px; }
.sidebar a { display: block; padding: 13px 16px; margin-bottom: 4px; border-radius: 10px; color: var(--text); text-decoration: none; }
.sidebar a:hover { background: var(--bg); }
.sidebar a.active { background: var(--accent); color: var(--accent-text); }
.content { flex: 1; padding: 32px; max-width: 1100px; }

/* page header */
.page-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; gap: 16px; }
.page-head .left { display: flex; align-items: center; gap: 12px; }

/* cards / sections */
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 24px; margin-bottom: 20px; }
.section { margin-bottom: 22px; }
.section > h3 { margin-bottom: 6px; }
.section .divider { height: 1px; background: var(--border); margin-bottom: 16px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px 18px; }
.form-grid .full { grid-column: 1 / -1; }
.field label { display: block; color: var(--muted); font-size: 14px; margin-bottom: 5px; }
.field .err { color: var(--danger); font-size: 13px; margin-top: 4px; }
.form-actions { display: flex; justify-content: flex-end; gap: 12px; margin-top: 8px; }

/* tables / lists */
table { width: 100%; border-collapse: collapse; }
thead th { text-align: left; font-size: 13px; letter-spacing: .04em; text-transform: uppercase; color: var(--muted);
  padding: 10px 14px; border-bottom: 2px solid var(--border); }
tbody td { padding: 13px 14px; border-bottom: 1px solid var(--border); }
tbody tr:nth-child(even) { background: #fafbfc; }
tbody tr:hover { background: #f0f5fb; }
td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
.pill { display: inline-block; padding: 3px 10px; border-radius: 999px; font-size: 13px; }
.pill.pending { background: var(--warn-bg); color: var(--warn); }
.pill.done { background: #e8f5e9; color: var(--ok); }

/* misc */
.error { color: var(--danger); }
.error-banner { background: #fdecea; color: var(--danger); border: 1px solid #f5c6c2; border-radius: 10px; padding: 12px 14px; margin-bottom: 16px; }
.notice { background: var(--warn-bg); border: 1px solid #f0d9a8; border-radius: 10px; padding: 14px 16px; }
.muted { color: var(--muted); } .grow { flex: 1; }
.tax-summary { display: grid; grid-template-columns: auto auto; gap: 6px 24px; justify-content: end; }
.tax-summary .label { color: var(--muted); } .tax-summary .val { text-align: right; font-variant-numeric: tabular-nums; }
.tax-summary .total { font-weight: 700; font-size: 19px; border-top: 1px solid var(--border); padding-top: 6px; }
```

- [ ] **Step 2: Write the failing component tests**

`tests/renderer/signed-money-input.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import SignedMoneyInput from '../../src/renderer/components/SignedMoneyInput'

describe('SignedMoneyInput', () => {
  it('accepts a negative value and reports a negative number', () => {
    const onChange = vi.fn()
    render(<SignedMoneyInput value={0} onChange={onChange} id="ro" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-0.40' } })
    expect(onChange).toHaveBeenCalledWith(-0.4)
  })
  it('treats empty as 0 and rejects letters', () => {
    const onChange = vi.fn()
    render(<SignedMoneyInput value={0} onChange={onChange} id="ro" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
    fireEvent.change(input, { target: { value: 'abc' } })
    expect(onChange).not.toHaveBeenCalledWith(NaN)
  })
})
```

`tests/renderer/state-select.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import StateSelect from '../../src/renderer/components/StateSelect'

describe('StateSelect', () => {
  it('lists states and reports the chosen one', () => {
    const onChange = vi.fn()
    render(<StateSelect value="" onChange={onChange} id="st" />)
    const sel = screen.getByRole('combobox') as HTMLSelectElement
    expect(screen.getByRole('option', { name: 'Gujarat' })).toBeTruthy()
    fireEvent.change(sel, { target: { value: 'Maharashtra' } })
    expect(onChange).toHaveBeenCalledWith('Maharashtra')
  })
})
```

- [ ] **Step 3: Run tests, verify they fail**

Run: `npx vitest run tests/renderer/signed-money-input.test.tsx tests/renderer/state-select.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement the components**

`src/renderer/components/SignedMoneyInput.tsx`:
```tsx
import { useState, useEffect } from 'react'
export default function SignedMoneyInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  const [text, setText] = useState(value === 0 ? '' : String(value))
  useEffect(() => { setText(value === 0 ? '' : String(value)) }, [value])
  return (
    <input id={id} type="text" inputMode="decimal" value={text}
      onChange={e => {
        const v = e.target.value
        if (v !== '' && v !== '-' && !/^-?\d*\.?\d*$/.test(v)) return
        setText(v)
        const n = (v === '' || v === '-') ? 0 : Number(v)
        onChange(Number.isNaN(n) ? 0 : n)
      }} />
  )
}
```

`src/renderer/components/StateSelect.tsx`:
```tsx
import { INDIAN_STATES } from '@shared/indian-states'
export default function StateSelect({ value, onChange, id }: { value: string; onChange: (s: string) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— select state —</option>
      {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}
```

`src/renderer/components/PincodeField.tsx`:
```tsx
import { lookupPincode } from '../lib/pincode'
export default function PincodeField({ value, onChange, onResolved, id }:
  { value: string; onChange: (s: string) => void; onResolved: (r: { city: string; state: string }) => void; id?: string }) {
  return (
    <input id={id} type="text" inputMode="numeric" maxLength={6} value={value}
      onChange={e => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6)
        onChange(v)
        if (v.length === 6) { const r = lookupPincode(v); if (r) onResolved(r) }
      }} />
  )
}
```

`src/renderer/components/PageHeader.tsx`:
```tsx
import type { ReactNode } from 'react'
export default function PageHeader({ title, action, back }: { title: string; action?: ReactNode; back?: () => void }) {
  return (
    <div className="page-head">
      <div className="left">
        {back && <button className="link" onClick={back}>‹ Back</button>}
        <h1>{title}</h1>
      </div>
      {action}
    </div>
  )
}
```

`src/renderer/components/FormSection.tsx`:
```tsx
import type { ReactNode } from 'react'
export default function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="section">
      <h3>{title}</h3>
      <div className="divider" />
      <div className="form-grid">{children}</div>
    </div>
  )
}
```

`src/renderer/components/FormPage.tsx`:
```tsx
import type { ReactNode } from 'react'
import PageHeader from './PageHeader'
export default function FormPage({ title, onBack, error, footer, children }:
  { title: string; onBack: () => void; error?: string; footer: ReactNode; children: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} back={onBack} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">{children}</div>
      <div className="form-actions">{footer}</div>
    </div>
  )
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/renderer/signed-money-input.test.tsx tests/renderer/state-select.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 6: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green (the theme/components are additive; existing screens still use old classes that remain defined — `.panel`, `.field`, `.row` are kept where still referenced; verify no screen visually breaks by typecheck/build, full visual redesign per screen follows).

> Note: screens not yet redesigned (Settings, Dashboard, and any screen before its task runs) still reference the legacy `.panel`, `.row`, and base `.field` classes. Keep them defined at the end of `theme.css` so nothing renders unstyled mid-migration:
> ```css
> .panel { background: var(--surface); border: 1px solid var(--border); border-radius: 14px; padding: 20px; margin-bottom: 20px; }
> .row { display: flex; gap: 16px; flex-wrap: wrap; }
> .field { display: flex; flex-direction: column; }
> ```

- [ ] **Step 7: Commit**

```bash
git add src/renderer/theme.css src/renderer/components/PageHeader.tsx src/renderer/components/FormPage.tsx src/renderer/components/FormSection.tsx src/renderer/components/StateSelect.tsx src/renderer/components/SignedMoneyInput.tsx src/renderer/components/PincodeField.tsx tests/renderer/signed-money-input.test.tsx tests/renderer/state-select.test.tsx
git commit -m "feat: cleaner theme + shared layout/form components (PageHeader, FormPage, FormSection, StateSelect, SignedMoneyInput, PincodeField)"
```

---

## Phase D — Screens

### Task 8: Onboarding (FirstRun) — full mandatory profile

**Files:**
- Modify: `src/renderer/screens/FirstRun.tsx` (replace)
- Test: none (visual screen; verify via typecheck + suite; do NOT run `npm run dev`)

**Interfaces:**
- Consumes: `window.api.chooseDataFolder`, `saveSettings`; `isGstin/isPan/isMobile/deriveInvoicePrefix` (`@shared/validation`); `StateSelect`.
- Mandatory + format-validated: business name, GSTIN, PAN, mobile, address, home state, data folder. Prefix auto-derived (editable). On submit, save `seller_name, seller_gstin, seller_pan, seller_phone, seller_address, home_state, invoice_prefix` and call `onDone`.

- [ ] **Step 1: Replace `src/renderer/screens/FirstRun.tsx`**

```tsx
import { useState } from 'react'
import { isGstin, isPan, isMobile, deriveInvoicePrefix } from '@shared/validation'
import StateSelect from '../components/StateSelect'

export default function FirstRun({ onDone }: { onDone: () => void }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixEdited, setPrefixEdited] = useState(false)
  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')
  const [mobile, setMobile] = useState('')
  const [homeState, setHomeState] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState('')

  function setBusinessName(v: string) {
    setName(v)
    if (!prefixEdited) setPrefix(deriveInvoicePrefix(v))
  }
  async function pick() { const f = await window.api.chooseDataFolder(); if (f) setFolder(f) }

  const valid =
    !!folder && name.trim().length > 0 && isGstin(gstin) && isPan(pan) &&
    isMobile(mobile) && homeState.trim().length > 0 && address.trim().length > 0 && prefix.trim().length > 0

  async function start() {
    setError('')
    if (!valid) { setError('Please fill every field correctly before continuing.'); return }
    try {
      await window.api.saveSettings({
        seller_name: name.trim(), seller_gstin: gstin.trim().toUpperCase(), seller_pan: pan.trim().toUpperCase(),
        seller_phone: mobile.trim(), seller_address: address.trim(), home_state: homeState,
        invoice_prefix: prefix.trim().toUpperCase()
      })
      onDone()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  const fieldErr = (cond: boolean, msg: string) => cond ? <div className="err">{msg}</div> : null

  return (
    <div className="content" style={{ maxWidth: 760, margin: '0 auto' }}>
      <h1 style={{ textAlign: 'center' }}>Welcome to Granule Trader</h1>
      <p className="muted" style={{ textAlign: 'center', marginTop: 4 }}>A one-time setup of your business details.</p>
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <div className="section">
          <h3>Data file</h3><div className="divider" />
          <div className="row" style={{ alignItems: 'center' }}>
            <input className="grow" readOnly value={folder ?? ''} placeholder="Choose a folder for your data file…" />
            <button onClick={pick}>Choose…</button>
          </div>
          <p className="muted" style={{ fontSize: 14 }}>A cloud-synced folder (Dropbox/Drive/iCloud) lets a second computer use the same data — open it on one computer at a time.</p>
        </div>

        <div className="section">
          <h3>Your business</h3><div className="divider" />
          <div className="form-grid">
            <div className="field full"><label>Business name</label>
              <input value={name} onChange={e => setBusinessName(e.target.value)} placeholder="e.g. Ramaxton Plastocrafts" /></div>
            <div className="field"><label>Invoice prefix (auto from name, editable)</label>
              <input value={prefix} onChange={e => { setPrefix(e.target.value.toUpperCase()); setPrefixEdited(true) }} /></div>
            <div className="field"><label>Mobile</label>
              <input value={mobile} onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))} placeholder="10 digits" />
              {fieldErr(mobile.length > 0 && !isMobile(mobile), 'Enter a 10-digit mobile number')}</div>
            <div className="field"><label>GSTIN</label>
              <input value={gstin} onChange={e => setGstin(e.target.value.toUpperCase())} placeholder="24ABCDE1234F1Z5" />
              {fieldErr(gstin.length > 0 && !isGstin(gstin), 'GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5')}</div>
            <div className="field"><label>PAN</label>
              <input value={pan} onChange={e => setPan(e.target.value.toUpperCase())} placeholder="ABCDE1234F" />
              {fieldErr(pan.length > 0 && !isPan(pan), 'PAN must be 10 characters, e.g. ABCDE1234F')}</div>
            <div className="field"><label>Home state (for tax)</label>
              <StateSelect value={homeState} onChange={setHomeState} /></div>
            <div className="field full"><label>Address</label>
              <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} /></div>
          </div>
        </div>

        <div className="form-actions">
          <button className="primary" disabled={!valid} onClick={start}>Start using Granule Trader</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test`
Expected: green. (Manual GUI check is deferred to the final verification; do not run `npm run dev`.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/screens/FirstRun.tsx
git commit -m "feat: onboarding with full mandatory profile, validation, auto prefix, state dropdown"
```

---

### Task 9: Customers — list page + form page (validation + pincode)

**Files:**
- Create: `src/renderer/screens/Customers.tsx` (replace — now list only), `src/renderer/screens/CustomerForm.tsx`
- Modify: `src/renderer/routes.tsx`
- Test: none (visual; typecheck + suite)

**Interfaces:**
- Consumes: `window.api.listCustomers/createCustomer/updateCustomer/deleteCustomer`; `isGstin/isPan/isMobile/isPincode`; `StateSelect`, `PincodeField`, `FormPage`, `FormSection`, `PageHeader`.
- Routes: `/customers` (list), `/customers/new`, `/customers/edit/:id`.

- [ ] **Step 1: Add routes** (`src/renderer/routes.tsx`)

Add `import CustomerForm from './screens/CustomerForm'` and routes:
```tsx
<Route path="/customers/new" element={<CustomerForm />} />
<Route path="/customers/edit/:id" element={<CustomerForm />} />
```

- [ ] **Step 2: Replace `src/renderer/screens/Customers.tsx`** (list only)

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Customer } from '@shared/types'
import PageHeader from '../components/PageHeader'

export default function Customers() {
  const nav = useNavigate()
  const [list, setList] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listCustomers(search || undefined)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [search])
  async function remove(id: number) {
    if (!confirm('Delete this customer?')) return
    try { await window.api.deleteCustomer(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Customers" action={<button className="primary" onClick={() => nav('/customers/new')}>+ Add customer</button>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <input placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.target.value)} style={{ maxWidth: 380, marginBottom: 16 }} />
        <table>
          <thead><tr><th>Name</th><th>GSTIN</th><th>City</th><th>State</th><th></th></tr></thead>
          <tbody>{list.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td><td>{c.gstin}</td><td>{c.billing_city}</td><td>{c.billing_state}</td>
              <td className="num"><button className="link" onClick={() => nav(`/customers/edit/${c.id}`)}>Edit</button>{' '}
                <button className="link danger" onClick={() => remove(c.id)}>Delete</button></td>
            </tr>))}
            {list.length === 0 && <tr><td colSpan={5} className="muted">No customers yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/screens/CustomerForm.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Customer } from '@shared/types'
import { isGstin, isPan, isMobile, isPincode } from '@shared/validation'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

const EMPTY: Omit<Customer, 'id'> = {
  name: '', gstin: '', pan: '', phone: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

export default function CustomerForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [form, setForm] = useState<Omit<Customer, 'id'>>(EMPTY)
  const [error, setError] = useState('')
  const set = (p: Partial<Omit<Customer, 'id'>>) => setForm(f => ({ ...f, ...p }))

  useEffect(() => {
    if (!editId) return
    window.api.listCustomers().then(all => {
      const c = all.find(x => x.id === editId)
      if (c) { const { id: _i, ...rest } = c; setForm(rest) }
    }).catch(e => setError(e.message ?? String(e)))
  }, [editId])

  const errs = {
    name: form.name.trim() ? '' : 'Required',
    gstin: isGstin(form.gstin) ? '' : 'GSTIN must be 15 characters',
    pan: !form.pan || isPan(form.pan) ? '' : 'PAN must be 10 characters',
    phone: !form.phone || isMobile(form.phone) ? '' : '10-digit mobile',
    billing_city: form.billing_city.trim() ? '' : 'Required',
    billing_state: form.billing_state.trim() ? '' : 'Required',
    billing_pincode: isPincode(form.billing_pincode) ? '' : '6-digit pincode',
    billing_address: form.billing_address.trim() ? '' : 'Required'
  }
  const valid = Object.values(errs).every(e => e === '')

  async function save() {
    setError('')
    if (!valid) { setError('Please fix the highlighted fields.'); return }
    try {
      const payload = { ...form, gstin: form.gstin.toUpperCase(), pan: form.pan.toUpperCase() }
      if (editId) await window.api.updateCustomer(editId, payload); else await window.api.createCustomer(payload)
      nav('/customers')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  const F = (label: string, node: React.ReactNode, err?: string, full?: boolean) => (
    <div className={'field' + (full ? ' full' : '')}><label>{label}</label>{node}{err ? <div className="err">{err}</div> : null}</div>
  )

  return (
    <FormPage title={editId ? 'Edit customer' : 'Add customer'} onBack={() => nav('/customers')} error={error}
      footer={<><button onClick={() => nav('/customers')}>Cancel</button><button className="primary" disabled={!valid} onClick={save}>Save customer</button></>}>
      <FormSection title="Business details">
        {F('Name', <input value={form.name} onChange={e => set({ name: e.target.value })} />, errs.name)}
        {F('GSTIN', <input value={form.gstin} onChange={e => set({ gstin: e.target.value.toUpperCase() })} />, errs.gstin)}
        {F('PAN', <input value={form.pan} onChange={e => set({ pan: e.target.value.toUpperCase() })} />, errs.pan)}
        {F('Phone', <input value={form.phone} onChange={e => set({ phone: e.target.value.replace(/\D/g, '').slice(0,10) })} />, errs.phone)}
      </FormSection>
      <FormSection title="Billing address">
        {F('Pincode', <PincodeField value={form.billing_pincode} onChange={v => set({ billing_pincode: v })}
            onResolved={r => set({ billing_city: r.city, billing_state: r.state })} />, errs.billing_pincode)}
        {F('City', <input value={form.billing_city} onChange={e => set({ billing_city: e.target.value })} />, errs.billing_city)}
        {F('State', <StateSelect value={form.billing_state} onChange={v => set({ billing_state: v })} />, errs.billing_state)}
        {F('Address', <textarea rows={2} value={form.billing_address} onChange={e => set({ billing_address: e.target.value })} />, errs.billing_address, true)}
      </FormSection>
      <label style={{ display: 'block', margin: '4px 0 14px' }}>
        <input type="checkbox" style={{ width: 'auto', marginRight: 8 }} checked={form.shipping_same} onChange={e => set({ shipping_same: e.target.checked })} />
        Shipping address is the same as billing
      </label>
      {!form.shipping_same && (
        <FormSection title="Shipping address">
          {F('Pincode', <PincodeField value={form.shipping_pincode} onChange={v => set({ shipping_pincode: v })}
              onResolved={r => set({ shipping_city: r.city, shipping_state: r.state })} />)}
          {F('City', <input value={form.shipping_city} onChange={e => set({ shipping_city: e.target.value })} />)}
          {F('State', <StateSelect value={form.shipping_state} onChange={v => set({ shipping_state: v })} />)}
          {F('Address', <textarea rows={2} value={form.shipping_address} onChange={e => set({ shipping_address: e.target.value })} />, undefined, true)}
        </FormSection>
      )}
    </FormPage>
  )
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm test`
Expected: green.
```bash
git add src/renderer/screens/Customers.tsx src/renderer/screens/CustomerForm.tsx src/renderer/routes.tsx
git commit -m "feat: customers list/form split with validation, state dropdown, pincode autofill"
```

---

### Task 10: Purchases — list + form (3-box tax, signed round-off, payment date)

**Files:**
- Create: `src/renderer/components/TaxSummary.tsx`, `src/renderer/screens/PurchaseForm.tsx`
- Modify: `src/renderer/screens/Purchases.tsx` (replace — list only), `src/renderer/routes.tsx`
- Test: none (visual; typecheck + suite)

**Interfaces:**
- Produces: `TaxSummary({ taxable, rows, total })` where `rows: { label: string; value: number }[]` — a dumb right-aligned summary (used by purchase + sale forms).
- Consumes: `window.api.listPurchases/nextPurchaseCode/createPurchase/updatePurchase/deletePurchase/getSettings/listHsn`; `computeTax` (`@shared/tax`); `formatINR`; `MoneyInput`, `SignedMoneyInput`, `StateSelect`, `FormPage`, `FormSection`, `PageHeader`.
- Routes: `/purchases` (list), `/purchases/new`, `/purchases/edit/:id`. The `NewPurchase` payload shape (Task 6 of v1) is unchanged: `{ our_code, supplier_invoice_number, invoice_date, party, party_state, hsn_code, qty_kg, amount, gst_rate, homeState, tcs?, roundoff?, payment_status?, payment_date? }`.

- [ ] **Step 1: Create `src/renderer/components/TaxSummary.tsx`**

```tsx
import { formatINR } from '../lib/format'
export default function TaxSummary({ taxable, rows, total }:
  { taxable: number; rows: { label: string; value: number }[]; total: number }) {
  return (
    <div className="tax-summary">
      <div className="label">Taxable</div><div className="val">{formatINR(taxable)}</div>
      {rows.map(r => (<><div key={r.label} className="label">{r.label}</div><div className="val">{formatINR(r.value)}</div></>))}
      <div className="label total">Net total</div><div className="val total">{formatINR(total)}</div>
    </div>
  )
}
```
> If the duplicate-key lint on the fragment bothers the build, give each row a keyed `<div key={r.label+'l'}>`/`<div key={r.label+'v'}>` pair wrapped in a `<React.Fragment key={r.label}>`.

- [ ] **Step 2: Add routes** (`src/renderer/routes.tsx`)

Add `import PurchaseForm from './screens/PurchaseForm'` and:
```tsx
<Route path="/purchases/new" element={<PurchaseForm />} />
<Route path="/purchases/edit/:id" element={<PurchaseForm />} />
```

- [ ] **Step 3: Replace `src/renderer/screens/Purchases.tsx`** (list only)

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Purchase } from '@shared/types'
import PageHeader from '../components/PageHeader'
import { formatINR } from '../lib/format'

export default function Purchases() {
  const nav = useNavigate()
  const [list, setList] = useState<Purchase[]>([])
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listPurchases()) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [])
  async function remove(id: number) {
    setError('')
    if (!confirm('Delete this purchase? Stock will be recalculated.')) return
    try { await window.api.deletePurchase(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Purchases" action={<button className="primary" onClick={() => nav('/purchases/new')}>+ Add purchase</button>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Code</th><th>Date</th><th>Supplier</th><th>HSN</th><th className="num">Qty</th><th className="num">Remaining</th><th className="num">Total</th><th>Payment</th><th></th></tr></thead>
          <tbody>{list.map(p => (
            <tr key={p.id}>
              <td>{p.our_code}</td><td>{p.invoice_date}</td><td>{p.party}</td><td>{p.hsn_code}</td>
              <td className="num">{p.qty_kg}</td><td className="num">{p.qty_remaining_kg}</td><td className="num">{formatINR(p.total_invoice_amount)}</td>
              <td><span className={'pill ' + p.payment_status}>{p.payment_status}</span></td>
              <td className="num"><button className="link" onClick={() => nav(`/purchases/edit/${p.id}`)}>Edit</button>{' '}
                <button className="link danger" onClick={() => remove(p.id)}>Delete</button></td>
            </tr>))}
            {list.length === 0 && <tr><td colSpan={9} className="muted">No purchases yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Create `src/renderer/screens/PurchaseForm.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { HsnProduct, Settings } from '@shared/types'
import { computeTax } from '@shared/tax'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import StateSelect from '../components/StateSelect'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import TaxSummary from '../components/TaxSummary'
import { today } from '../lib/format'

export default function PurchaseForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [form, setForm] = useState({
    our_code: '', supplier_invoice_number: '', invoice_date: today(),
    party: '', party_state: '', hsn_code: '', qty_kg: 0, amount: 0, roundoff: 0,
    payment_status: 'pending' as 'pending' | 'done', payment_date: '' as string
  })
  const [error, setError] = useState('')
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }))

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn())
      if (editId) {
        const p = (await window.api.listPurchases()).find(x => x.id === editId)
        if (p) setForm({ our_code: p.our_code, supplier_invoice_number: p.supplier_invoice_number, invoice_date: p.invoice_date,
          party: p.party, party_state: p.party_state, hsn_code: p.hsn_code, qty_kg: p.qty_kg, amount: p.amount,
          roundoff: p.roundoff, payment_status: p.payment_status, payment_date: p.payment_date ?? '' })
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [editId])

  // auto-suggest code only when creating (never overwrite an edited purchase's code)
  useEffect(() => { if (!editId) window.api.nextPurchaseCode(form.invoice_date).then(c => setForm(f => ({ ...f, our_code: c }))) }, [form.invoice_date, editId])

  if (!settings) return <FormPage title="Purchase" onBack={() => nav('/purchases')} footer={null}><p>Loading…</p></FormPage>

  const gstRate = hsn.find(h => h.hsn_code === form.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const tax = computeTax({ amount: form.amount, gstRate, placeOfSupplyState: form.party_state, homeState: settings.home_state, roundoff: form.roundoff })
  const intra = tax.igst === 0
  const rows = [
    { label: `CGST ${intra ? gstRate / 2 : 0}%`, value: tax.cgst },
    { label: `SGST ${intra ? gstRate / 2 : 0}%`, value: tax.sgst },
    { label: `IGST ${intra ? 0 : gstRate}%`, value: tax.igst }
  ]
  const valid = form.our_code.trim() && form.hsn_code && form.party_state && form.qty_kg > 0 && form.amount > 0

  async function save() {
    setError('')
    if (!valid) { setError('Fill code, supplier state, HSN, quantity and amount.'); return }
    try {
      const payload = {
        our_code: form.our_code, supplier_invoice_number: form.supplier_invoice_number, invoice_date: form.invoice_date,
        party: form.party, party_state: form.party_state, hsn_code: form.hsn_code, qty_kg: form.qty_kg, amount: form.amount,
        gst_rate: gstRate, homeState: settings!.home_state, roundoff: form.roundoff,
        payment_status: form.payment_status, payment_date: form.payment_status === 'done' ? (form.payment_date || today()) : null
      }
      if (editId) await window.api.updatePurchase(editId, payload); else await window.api.createPurchase(payload)
      nav('/purchases')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <FormPage title={editId ? 'Edit purchase' : 'Add purchase'} onBack={() => nav('/purchases')} error={error}
      footer={<><button onClick={() => nav('/purchases')}>Cancel</button><button className="primary" disabled={!valid} onClick={save}>{editId ? 'Update purchase' : 'Save purchase'}</button></>}>
      <FormSection title="Invoice">
        <div className="field"><label>Our code</label><input value={form.our_code} onChange={e => set({ our_code: e.target.value })} /></div>
        <div className="field"><label>Supplier invoice no.</label><input value={form.supplier_invoice_number} onChange={e => set({ supplier_invoice_number: e.target.value })} /></div>
        <div className="field"><label>Invoice date</label><input type="date" value={form.invoice_date} onChange={e => set({ invoice_date: e.target.value })} /></div>
        <div className="field"><label>HSN</label>
          <select value={form.hsn_code} onChange={e => set({ hsn_code: e.target.value })}>
            <option value="">— select —</option>{hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
          </select></div>
      </FormSection>
      <FormSection title="Supplier">
        <div className="field"><label>Supplier name</label><input value={form.party} onChange={e => set({ party: e.target.value })} /></div>
        <div className="field"><label>Supplier state</label><StateSelect value={form.party_state} onChange={v => set({ party_state: v })} /></div>
      </FormSection>
      <FormSection title="Amounts">
        <div className="field"><label>Quantity (kg)</label><MoneyInput value={form.qty_kg} onChange={n => set({ qty_kg: n })} /></div>
        <div className="field"><label>Taxable amount</label><MoneyInput value={form.amount} onChange={n => set({ amount: n })} /></div>
        <div className="field"><label>Round off (can be negative)</label><SignedMoneyInput value={form.roundoff} onChange={n => set({ roundoff: n })} /></div>
        <div className="field"><label>Payment</label>
          <select value={form.payment_status} onChange={e => set({ payment_status: e.target.value as 'pending' | 'done' })}>
            <option value="pending">Pending</option><option value="done">Done</option>
          </select></div>
        {form.payment_status === 'done' && (
          <div className="field"><label>Payment date</label><input type="date" value={form.payment_date || today()} onChange={e => set({ payment_date: e.target.value })} /></div>
        )}
      </FormSection>
      <div className="section"><h3>Tax</h3><div className="divider" /><TaxSummary taxable={tax.taxable_amount} rows={rows} total={tax.total} /></div>
    </FormPage>
  )
}
```

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck && npm test`
Expected: green.
```bash
git add src/renderer/components/TaxSummary.tsx src/renderer/screens/Purchases.tsx src/renderer/screens/PurchaseForm.tsx src/renderer/routes.tsx
git commit -m "feat: purchases list/form split with 3-box tax, signed round-off, payment date"
```

---

### Task 11: New Sale — multi-HSN lot table, live tax, simplified

**Files:**
- Modify: `src/renderer/screens/NewSale.tsx` (replace)
- Test: none (visual; typecheck + suite)

**Interfaces:**
- Consumes: `window.api.listAvailableLots/nextInvoiceNumber/createSale/fillReservedSale/getSaleWithAllocations/listCustomers/getSettings/listHsn`; `computeSaleTax` (`@shared/tax`); `placeOfSupplyState` (`../../main/core/customers`, pure); `MoneyInput`, `SignedMoneyInput`, `TaxSummary`, `PageHeader`; `formatINR`, `today`.
- Builds `NewSale` (Task 4 shape: per-line `hsn_code` + `gst_rate`, no sale-level HSN/TCS, optional `roundoff`).

- [ ] **Step 1: Replace `src/renderer/screens/NewSale.tsx`**

```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Customer, AvailableLot, Settings, HsnProduct } from '@shared/types'
import { computeSaleTax } from '@shared/tax'
import { placeOfSupplyState } from '../../main/core/customers'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import PageHeader from '../components/PageHeader'
import TaxSummary from '../components/TaxSummary'
import { formatINR, today } from '../lib/format'

interface Draw { include: boolean; qty: number; rate: number }

export default function NewSale() {
  const nav = useNavigate()
  const { id } = useParams()
  const fillId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [lots, setLots] = useState<AvailableLot[]>([])
  const [purchaseCost, setPurchaseCost] = useState<Map<number, number>>(new Map())
  const [error, setError] = useState('')

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [buyerId, setBuyerId] = useState<number | null>(null)
  const [showOptional, setShowOptional] = useState(false)
  const [ewayNo, setEwayNo] = useState(''); const [ewayDate, setEwayDate] = useState(''); const [vehicle, setVehicle] = useState('')
  const [roundoff, setRoundoff] = useState(0)
  const [payment, setPayment] = useState<'pending' | 'done'>('pending'); const [paymentDate, setPaymentDate] = useState('')
  const [draw, setDraw] = useState<Record<number, Draw>>({})

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setCustomers(await window.api.listCustomers()); setHsn(await window.api.listHsn())
      // cost/kg per lot = purchase.amount / qty_kg (reference only)
      const ps = await window.api.listPurchases()
      setPurchaseCost(new Map(ps.map(p => [p.id, p.qty_kg > 0 ? p.amount / p.qty_kg : 0])))
      if (fillId) { const { sale } = await window.api.getSaleWithAllocations(fillId); setInvoiceNumber(sale.invoice_number); setInvoiceDate(sale.invoice_date ?? today()) }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [fillId])

  useEffect(() => { window.api.listAvailableLots(invoiceDate, fillId ?? undefined).then(setLots).catch(e => setError(e.message ?? String(e))) }, [invoiceDate, fillId])
  useEffect(() => { if (!fillId && settings) window.api.nextInvoiceNumber(invoiceDate, settings.invoice_prefix).then(setInvoiceNumber) }, [invoiceDate, settings, fillId])

  const buyer = customers.find(c => c.id === buyerId) ?? null
  const placeOfSupply = buyer ? placeOfSupplyState(buyer) : ''
  const intra = !!settings && placeOfSupply.trim().toLowerCase() === settings.home_state.trim().toLowerCase()
  const hsnRate = useMemo(() => new Map(hsn.map(h => [h.hsn_code, h.gst_rate])), [hsn])

  const lines = useMemo(() => lots
    .filter(l => draw[l.purchase_id]?.include && (draw[l.purchase_id]?.qty ?? 0) > 0)
    .map(l => ({ purchase_id: l.purchase_id, qty_drawn_kg: draw[l.purchase_id].qty, rate_per_kg: draw[l.purchase_id].rate,
      hsn_code: l.hsn_code, gst_rate: hsnRate.get(l.hsn_code) ?? settings?.default_gst_rate ?? 18 })), [lots, draw, hsnRate, settings])

  const tax = computeSaleTax({ lines, placeOfSupplyState: placeOfSupply, homeState: settings?.home_state ?? '', roundoff })
  const rows = [
    { label: intra ? 'CGST' : 'CGST 0%', value: tax.cgst },
    { label: intra ? 'SGST' : 'SGST 0%', value: tax.sgst },
    { label: intra ? 'IGST 0%' : 'IGST', value: tax.igst }
  ]
  function setLine(pid: number, patch: Partial<Draw>) {
    setDraw(d => ({ ...d, [pid]: { include: false, qty: 0, rate: 0, ...d[pid], ...patch } }))
  }

  async function save(thenInvoice: boolean) {
    setError('')
    if (!buyer) { setError('Choose a buyer first.'); return }
    if (lines.length === 0) { setError('Tick at least one lot and enter quantity + rate.'); return }
    if (lines.some(l => l.rate_per_kg <= 0)) { setError('Enter a rate greater than 0 for every chosen lot.'); return }
    const payload = {
      invoice_number: invoiceNumber, invoice_date: invoiceDate,
      buyer_customer_id: buyer.id, buyer_name: buyer.name, buyer_gstin: buyer.gstin,
      buyer_billing: { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode },
      buyer_shipping: buyer.shipping_same
        ? { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode }
        : { address: buyer.shipping_address, city: buyer.shipping_city, state: buyer.shipping_state, pincode: buyer.shipping_pincode },
      place_of_supply_state: placeOfSupply, homeState: settings!.home_state,
      lines, roundoff, eway_bill_no: ewayNo, eway_bill_date: ewayDate, vehicle,
      payment_status: payment, payment_date: payment === 'done' ? (paymentDate || today()) : null
    }
    try {
      const sale = fillId ? await window.api.fillReservedSale(fillId, payload) : await window.api.createSale(payload)
      nav(thenInvoice ? `/invoice/${sale.id}` : '/sales')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  if (!settings) return <div className="content">Loading…</div>
  return (
    <div>
      <PageHeader title={fillId ? 'Fill reserved invoice' : 'New sale'} back={() => nav('/sales')} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <div className="form-grid">
          <div className="field"><label>Invoice number</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
          <div className="field"><label>Invoice date</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
          <div className="field full"><label>Buyer</label>
            <select value={buyerId ?? ''} onChange={e => setBuyerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— choose customer —</option>{customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.gstin ? ` (${c.gstin})` : ''}</option>)}
            </select></div>
        </div>
        {buyer && <p className="muted">Place of supply: <b>{placeOfSupply || '—'}</b> → {intra ? 'CGST + SGST' : 'IGST'}</p>}
        <button className="link" onClick={() => setShowOptional(s => !s)}>{showOptional ? '▾' : '▸'} Optional (e-way bill, vehicle)</button>
        {showOptional && (
          <div className="form-grid" style={{ marginTop: 8 }}>
            <div className="field"><label>E-way bill no.</label><input value={ewayNo} onChange={e => setEwayNo(e.target.value)} /></div>
            <div className="field"><label>E-way bill date</label><input type="date" value={ewayDate} onChange={e => setEwayDate(e.target.value)} /></div>
            <div className="field full"><label>Vehicle</label><input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="By Taxi / By Van / GJ-05-…" /></div>
          </div>
        )}
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Choose stock to sell (lots available on {invoiceDate})</h3>
        <table>
          <thead><tr><th></th><th>Lot</th><th>HSN</th><th>Supplier</th><th className="num">Avail</th><th className="num">Cost/kg</th><th className="num">Sell/kg</th><th className="num">Qty</th><th className="num">Amount</th></tr></thead>
          <tbody>{lots.map(l => {
            const d = draw[l.purchase_id] ?? { include: false, qty: 0, rate: 0 }
            const amt = d.include ? d.qty * d.rate : 0
            return (
              <tr key={l.purchase_id}>
                <td><input type="checkbox" style={{ width: 'auto' }} checked={d.include} onChange={e => setLine(l.purchase_id, { include: e.target.checked })} /></td>
                <td>{l.our_code}</td><td>{l.hsn_code}</td><td>{l.party}</td><td className="num">{l.available_kg}</td>
                <td className="num">{formatINR(purchaseCost.get(l.purchase_id) ?? 0)}</td>
                <td className="num">{d.include ? <MoneyInput value={d.rate} onChange={n => setLine(l.purchase_id, { rate: n })} /> : '—'}</td>
                <td className="num">{d.include ? <MoneyInput value={d.qty} onChange={n => setLine(l.purchase_id, { qty: n })} /> : '—'}</td>
                <td className="num">{formatINR(amt)}</td>
              </tr>)
          })}
          {lots.length === 0 && <tr><td colSpan={9} className="error">No stock available on this date.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="field" style={{ maxWidth: 220 }}><label>Round off (can be negative)</label><SignedMoneyInput value={roundoff} onChange={setRoundoff} /></div>
            <div className="field" style={{ maxWidth: 320 }}><label>Payment</label>
              <div className="row" style={{ alignItems: 'center' }}>
                <select value={payment} onChange={e => setPayment(e.target.value as 'pending' | 'done')}>
                  <option value="pending">Pending</option><option value="done">Done</option></select>
                {payment === 'done' && <input type="date" value={paymentDate || today()} onChange={e => setPaymentDate(e.target.value)} />}
              </div></div>
          </div>
          <TaxSummary taxable={tax.taxable} rows={rows} total={tax.total} />
        </div>
        <div className="form-actions">
          <button onClick={() => nav('/sales')}>Cancel</button>
          <button className="primary" onClick={() => save(false)}>Save</button>
          <button className="primary" onClick={() => save(true)}>Save &amp; preview PDF</button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test`
Expected: green. (`listPurchases` is already on `window.api`; cost/kg is derived from it.)
```bash
git add src/renderer/screens/NewSale.tsx
git commit -m "feat: new-sale redesign — multi-HSN lot table, live tax, signed round-off, payment date, preview PDF"
```

---

### Task 12: Sales register — per-row invoice preview

**Files:**
- Modify: `src/renderer/screens/Sales.tsx` (replace)
- Test: none (visual; typecheck + suite)

**Interfaces:**
- Consumes: `window.api.listSales/deleteSale`; `PageHeader`; `formatINR`.
- Created rows show **Preview / PDF** → `/invoice/:id` and **Delete**; reserved rows show **Fill** → `/sales/fill/:id`.

- [ ] **Step 1: Replace `src/renderer/screens/Sales.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Sale } from '@shared/types'
import PageHeader from '../components/PageHeader'
import { formatINR } from '../lib/format'

export default function Sales() {
  const nav = useNavigate()
  const [list, setList] = useState<Sale[]>([])
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listSales()) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [])
  async function remove(id: number) {
    setError('')
    if (!confirm('Delete this sale? Stock will be restored.')) return
    try { await window.api.deleteSale(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Sales" action={<button className="primary" onClick={() => nav('/sales/new')}>+ New sale</button>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th className="num">Qty</th><th className="num">Total</th><th>Payment</th><th></th></tr></thead>
          <tbody>{list.map(s => s.status === 'reserved' ? (
            <tr key={s.id} className="muted">
              <td>{s.invoice_number}</td><td colSpan={4}><i>reserved — blank</i></td><td></td>
              <td className="num"><button className="link" onClick={() => nav(`/sales/fill/${s.id}`)}>Fill</button></td>
            </tr>
          ) : (
            <tr key={s.id}>
              <td>{s.invoice_number}</td><td>{s.invoice_date}</td><td>{s.buyer_name}</td>
              <td className="num">{s.total_qty_kg}</td><td className="num">{formatINR(s.total_invoice_amount)}</td>
              <td><span className={'pill ' + s.payment_status}>{s.payment_status}</span></td>
              <td className="num">
                <button className="link" onClick={() => nav(`/invoice/${s.id}`)}>Preview / PDF</button>{' '}
                <button className="link danger" onClick={() => remove(s.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {list.length === 0 && <tr><td colSpan={7} className="muted">No sales yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test`
```bash
git add src/renderer/screens/Sales.tsx
git commit -m "feat: sales register with per-row invoice preview + payment pills"
```

---

### Task 13: Stock ledger + dedicated adjustment screen

**Files:**
- Modify: `src/renderer/screens/Stock.tsx` (replace — ledger only), `src/renderer/routes.tsx`
- Create: `src/renderer/screens/StockAdjust.tsx`
- Test: none (visual; typecheck + suite)

**Interfaces:**
- Consumes: `window.api.stockLedger/createStockAdjustment/listAdjustments/deleteAdjustment/getSettings`; `MoneyInput`, `PageHeader`; `formatINR`/`today`.
- Routes: `/stock` (ledger), `/stock/adjust`.

- [ ] **Step 1: Add route** (`src/renderer/routes.tsx`)

Add `import StockAdjust from './screens/StockAdjust'` and `<Route path="/stock/adjust" element={<StockAdjust />} />`.

- [ ] **Step 2: Replace `src/renderer/screens/Stock.tsx`** (ledger only)

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LedgerRow, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'

export default function Stock() {
  const nav = useNavigate()
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { (async () => {
    try { setSettings(await window.api.getSettings()); setRows(await window.api.stockLedger()) } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [])
  const low = settings?.low_stock_threshold ?? 0
  let lastHsn = ''; let running = 0
  return (
    <div>
      <PageHeader title="Stock" action={<>
        <button onClick={() => nav('/sales/new')}>New sale from stock</button>{' '}
        <button className="primary" onClick={() => nav('/stock/adjust')}>Adjust stock</button>
      </>} />
      {error && <div className="error-banner">{error}</div>}
      <div className="card">
        <table>
          <thead><tr><th>HSN</th><th>Lot</th><th>Date</th><th>Supplier</th><th className="num">In</th><th className="num">Consumed</th><th className="num">Balance</th><th className="num">Running</th></tr></thead>
          <tbody>{rows.map(r => {
            if (r.hsn_code !== lastHsn) { lastHsn = r.hsn_code; running = 0 }
            running += r.balance_kg
            const isLow = r.balance_kg < low
            return (
              <tr key={r.purchase_id} style={isLow ? { background: 'var(--warn-bg)' } : undefined}>
                <td>{r.hsn_code}</td><td>{r.our_code}</td><td>{r.invoice_date}</td><td>{r.party}</td>
                <td className="num">{r.qty_kg}</td><td className="num">{r.consumed_kg}</td><td className="num">{r.balance_kg}{isLow ? ' ⚠' : ''}</td><td className="num">{running}</td>
              </tr>)
          })}
          {rows.length === 0 && <tr><td colSpan={8} className="muted">No stock on hand.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Create `src/renderer/screens/StockAdjust.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LedgerRow } from '@shared/types'
import type { AdjustmentRow } from '../../main/core/adjustment'
import PageHeader from '../components/PageHeader'
import MoneyInput from '../components/MoneyInput'
import { today } from '../lib/format'

const REASONS = ['Spillage / wastage', 'Sample given', 'Loss / damage', 'Correction']

export default function StockAdjust() {
  const nav = useNavigate()
  const [lots, setLots] = useState<LedgerRow[]>([])
  const [recent, setRecent] = useState<AdjustmentRow[]>([])
  const [error, setError] = useState('')
  const [adj, setAdj] = useState({ purchase_id: null as number | null, qty_kg: 0, reason: REASONS[0], date: today() })

  async function reload() {
    try { setLots(await window.api.stockLedger()); setRecent(await window.api.listAdjustments()) }
    catch (e: any) { setError(e.message ?? String(e)) }
  }
  useEffect(() => { reload() }, [])

  async function save() {
    setError('')
    if (!adj.purchase_id || adj.qty_kg <= 0) { setError('Choose a lot and a quantity greater than 0.'); return }
    try {
      await window.api.createStockAdjustment({ purchase_id: adj.purchase_id, qty_kg: adj.qty_kg, reason: adj.reason, date: adj.date })
      setAdj({ purchase_id: null, qty_kg: 0, reason: REASONS[0], date: today() }); reload()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }
  async function undo(id: number) {
    if (!confirm('Undo this adjustment? The quantity will be added back to the lot.')) return
    try { await window.api.deleteAdjustment(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <div>
      <PageHeader title="Stock adjustment" back={() => nav('/stock')} />
      {error && <div className="error-banner">{error}</div>}

      <div className="card">
        <p>A stock adjustment records granules that left your stock <b>without a sale</b>, so your stock figures stay correct. Use it for:</p>
        <ul className="muted" style={{ marginTop: 4 }}>
          <li><b>Spillage / wastage</b> — material spilled or unusable</li>
          <li><b>Sample given</b> — free sample handed to a customer</li>
          <li><b>Loss / damage</b> — stock damaged, lost, or stolen</li>
          <li><b>Correction</b> — fixing a counting mistake</li>
        </ul>
        <div className="notice">This permanently reduces the selected lot's remaining quantity. It does <b>not</b> create an invoice, does <b>not</b> involve a customer, and has <b>no GST effect</b> — it is not a sale. You cannot remove more than the lot's available balance.</div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Record an adjustment</h3>
        <div className="form-grid">
          <div className="field full"><label>Lot</label>
            <select value={adj.purchase_id ?? ''} onChange={e => setAdj({ ...adj, purchase_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— choose lot —</option>
              {lots.map(r => <option key={r.purchase_id} value={r.purchase_id}>{r.our_code} ({r.hsn_code}) — {r.balance_kg} kg left</option>)}
            </select></div>
          <div className="field"><label>Quantity removed (kg)</label><MoneyInput value={adj.qty_kg} onChange={n => setAdj({ ...adj, qty_kg: n })} /></div>
          <div className="field"><label>Date</label><input type="date" value={adj.date} onChange={e => setAdj({ ...adj, date: e.target.value })} /></div>
          <div className="field full"><label>Reason</label>
            <select value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })}>{REASONS.map(r => <option key={r} value={r}>{r}</option>)}</select></div>
        </div>
        <div className="form-actions"><button className="primary" onClick={save}>Record adjustment</button></div>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Recent adjustments</h3>
        <table>
          <thead><tr><th>Lot</th><th className="num">Qty removed</th><th>Reason</th><th>Date</th><th></th></tr></thead>
          <tbody>{recent.map(a => (
            <tr key={a.id}><td>{a.our_code}</td><td className="num">{a.qty_kg}</td><td>{a.reason}</td><td>{a.date}</td>
              <td className="num"><button className="link danger" onClick={() => undo(a.id)}>Undo</button></td></tr>))}
            {recent.length === 0 && <tr><td colSpan={5} className="muted">No adjustments yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm test`
```bash
git add src/renderer/screens/Stock.tsx src/renderer/screens/StockAdjust.tsx src/renderer/routes.tsx
git commit -m "feat: stock ledger + dedicated adjustment screen with guidance/disclaimer/undo"
```

---

### Task 14: Invoice template — per-line HSN + HSN-wise tax summary

**Files:**
- Modify: `src/renderer/invoice/InvoiceTemplate.tsx` (replace)
- Test: update `tests/renderer/invoice-template.test.tsx`

**Interfaces:**
- Consumes: `Sale`, `SaleAllocation` (allocations now carry `hsn_code`, `gst_rate`), `Settings`; `formatINR`.
- Renders each allocation as a line with its own HSN; adds an HSN-wise tax breakup (taxable + CGST/SGST or IGST per HSN) and the grand total.

- [ ] **Step 1: Update the test** (`tests/renderer/invoice-template.test.tsx`)

Ensure the allocation fixtures carry `hsn_code` + `gst_rate` (from Task 4). Add an assertion that the HSN appears in a line and the totals render. Keep the existing intra (CGST/SGST) and inter (IGST) cases. Example additions to the intra test:
```tsx
expect(screen.getByText('3902')).toBeTruthy()      // per-line HSN shown
expect(screen.getByText(/84,000\.00/)).toBeTruthy() // taxable
```
Make the inter-state test's allocation use `gst_rate: 18` and the sale `igst: 15120, cgst: 0, sgst: 0` so the HSN-wise summary shows an IGST figure; assert `screen.getByText('IGST')` present and `queryByText('CGST')` null.

- [ ] **Step 2: Replace `src/renderer/invoice/InvoiceTemplate.tsx`**

```tsx
import type { Sale, SaleAllocation, Settings } from '@shared/types'
import { formatINR } from '../lib/format'
import './invoice.css'

function addr(json: string): string {
  if (!json) return ''
  try { const o = JSON.parse(json); return [o.address, o.city, o.state, o.pincode].filter(Boolean).join(', ') } catch { return '' }
}

export default function InvoiceTemplate({ sale, allocations, settings }: { sale: Sale; allocations: SaleAllocation[]; settings: Settings }) {
  const interState = sale.igst > 0
  // HSN-wise taxable + tax breakup
  const byHsn = new Map<string, { hsn: string; rate: number; taxable: number }>()
  for (const a of allocations) {
    const key = `${a.hsn_code}@${a.gst_rate}`
    const cur = byHsn.get(key) ?? { hsn: a.hsn_code, rate: a.gst_rate, taxable: 0 }
    cur.taxable = Math.round((cur.taxable + a.line_amount + Number.EPSILON) * 100) / 100
    byHsn.set(key, cur)
  }
  const groups = [...byHsn.values()]
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

  return (
    <div className="invoice">
      <div className="head">
        <div><h2>{settings.seller_name}</h2><div>{settings.seller_address}</div>
          <div>GSTIN: {settings.seller_gstin} · PAN: {settings.seller_pan}{settings.seller_phone ? ` · ${settings.seller_phone}` : ''}</div></div>
        <div style={{ textAlign: 'right' }}><b>TAX INVOICE</b><div>{sale.invoice_number}</div><div>{sale.invoice_date}</div></div>
      </div>
      <table>
        <tbody>
          <tr><td><b>Buyer:</b> {sale.buyer_name}<br />{addr(sale.buyer_billing_json)}<br />GSTIN: {sale.buyer_gstin}</td>
            <td><b>Ship to:</b><br />{addr(sale.buyer_shipping_json) || addr(sale.buyer_billing_json)}</td></tr>
        </tbody>
      </table>
      {(() => { const parts = [sale.eway_bill_no ? `E-way bill: ${sale.eway_bill_no} (${sale.eway_bill_date ?? ''})` : '', sale.vehicle ? `Vehicle: ${sale.vehicle}` : ''].filter(Boolean); return parts.length ? <p>{parts.join(' · ')}</p> : null })()}
      <table>
        <thead><tr><th>#</th><th>HSN</th><th>Qty (kg)</th><th>Rate/kg</th><th>Amount</th></tr></thead>
        <tbody>{allocations.map((a, i) => (
          <tr key={a.id}><td>{i + 1}</td><td>{a.hsn_code}</td><td>{a.qty_drawn_kg}</td><td>{formatINR(a.rate_per_kg)}</td><td>{formatINR(a.line_amount)}</td></tr>
        ))}</tbody>
      </table>

      <table style={{ marginTop: 8 }}>
        <thead><tr><th>HSN</th><th>Taxable</th>{interState ? <th>IGST</th> : <><th>CGST</th><th>SGST</th></>}</tr></thead>
        <tbody>{groups.map(g => (
          <tr key={g.hsn + g.rate}><td>{g.hsn} ({g.rate}%)</td><td>{formatINR(g.taxable)}</td>
            {interState
              ? <td>{formatINR(r2(g.taxable * g.rate / 100))}</td>
              : <><td>{formatINR(r2(g.taxable * g.rate / 2 / 100))}</td><td>{formatINR(r2(g.taxable * g.rate / 2 / 100))}</td></>}
          </tr>))}</tbody>
      </table>

      <table className="totals" style={{ marginTop: 8 }}>
        <tbody>
          <tr><td style={{ textAlign: 'right' }}>Taxable value</td><td style={{ textAlign: 'right' }}>{formatINR(sale.amount)}</td></tr>
          {interState
            ? <tr><td style={{ textAlign: 'right' }}>IGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.igst)}</td></tr>
            : <><tr><td style={{ textAlign: 'right' }}>CGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.cgst)}</td></tr>
              <tr><td style={{ textAlign: 'right' }}>SGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.sgst)}</td></tr></>}
          {sale.roundoff ? <tr><td style={{ textAlign: 'right' }}>Round off</td><td style={{ textAlign: 'right' }}>{formatINR(sale.roundoff)}</td></tr> : null}
          <tr><td style={{ textAlign: 'right' }}><b>Total</b></td><td style={{ textAlign: 'right' }}><b>{formatINR(sale.total_invoice_amount)}</b></td></tr>
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Run the template test + suite**

Run: `npx vitest run tests/renderer/invoice-template.test.tsx && npm test && npm run typecheck`
Expected: PASS / green.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/invoice/InvoiceTemplate.tsx tests/renderer/invoice-template.test.tsx
git commit -m "feat: invoice template with per-line HSN + HSN-wise tax summary"
```

---

### Task 15: Settings update, Dashboard polish, full verification

**Files:**
- Modify: `src/renderer/screens/Settings.tsx`, `src/renderer/screens/Dashboard.tsx`
- Test: none new (verification task)

**Interfaces:**
- Settings adds the seller **Mobile** field (`seller_phone`) and uses `StateSelect` for `home_state`; keeps the editable invoice prefix.

- [ ] **Step 1: Settings — add mobile + state dropdown**

In `src/renderer/screens/Settings.tsx`, in the Business section add a Mobile field bound to `s.seller_phone` and switch the Home-state input to `StateSelect`:
- Import `StateSelect from '../components/StateSelect'`.
- Add field: `<div className="field grow"><label>Mobile</label><input value={s.seller_phone} onChange={e => set({ seller_phone: e.target.value.replace(/\D/g,'').slice(0,10) })} /></div>`.
- Replace the Home-state `<input>` with `<StateSelect value={s.home_state} onChange={v => set({ home_state: v })} />`.
(`seller_phone` is already in `Settings`/`DEFAULT_SETTINGS` from Task 4, so `getSettings`/`saveSettings` round-trip it automatically.)

- [ ] **Step 2: Dashboard — use PageHeader for visual consistency**

In `src/renderer/screens/Dashboard.tsx`, replace the bare `<h1>` greeting block with `<PageHeader title={...} />` (import it) and keep the KPI cards/lists. Wrap the date under the header. No logic change. (The Dashboard does not reference the removed `sale.hsn_code`, so nothing else changes.)

- [ ] **Step 3: Full verification**

Run: `npm test`
Expected: all tests green.
Run: `npm run typecheck`
Expected: no errors.
Run: `npm run build`
Expected: main/preload/renderer all build.

- [ ] **Step 4: Manual end-to-end pass (human/operator)**

`npm run dev`, then: complete onboarding (all fields validated, prefix auto-fills from name) → Settings shows mobile + state dropdown → add a Customer (pincode auto-fills city/state, GSTIN validated) → add two Purchases of different HSNs (3-box tax, negative round-off, payment date when Done) → New Sale: tick lots across both HSNs, see cost/kg + live CGST/SGST/Net, Save & preview PDF → invoice shows per-line HSN + HSN-wise summary → Sales register row "Preview / PDF" reopens it → Stock → Adjust stock (guidance + disclaimer, record then Undo restores) → Dashboard KPIs.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/screens/Settings.tsx src/renderer/screens/Dashboard.tsx
git commit -m "feat: settings mobile + state dropdown; dashboard header polish"
```

---

## Notes for the implementer

- **Build-green discipline:** Task 4 changes the data model and all its consumers together. Run `npm run typecheck` after every task; a red typecheck means a consumer of a changed shape was missed.
- **No inline tax duplication:** both the renderer previews and `sale.ts` storage call the same `@shared/tax` functions — never re-derive tax math inline.
- **Pincode normalization:** if the offline package returns states in a case/format that doesn't equal an `INDIAN_STATES` entry, normalize in `lookupPincode` (Task 3) so the place-of-supply comparison and the dropdown agree.
- **Debugging:** for any test failure or unexpected behavior that isn't a one-line fix, use the systematic-debugging skill (find root cause, write a failing test, then fix) rather than patching symptoms.
- **GUI:** implementers must not run `npm run dev` (the window won't exit headless); rely on `npm run typecheck` + the suite. The manual GUI pass (Task 15 Step 4) is for the operator.
