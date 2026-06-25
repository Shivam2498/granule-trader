# Sale Form Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On the New Sale / Fill-reserved-invoice screen, make the vehicle number mandatory, catch over-draw (qty > a lot's available stock) live with a clear message, show the chosen buyer's GSTIN/address read-only, and gate Save behind a single plain-English validity check.

**Architecture:** Extract the save-gating logic into a pure, unit-tested renderer helper `src/renderer/lib/sale-validation.ts` (`lotDrawError`, `saleFormError`). Wire it into `NewSale.tsx`: per-lot red error text, `withAsterisk` required vehicle pulled out of the "Optional" collapse, a read-only buyer details block, and `disabled` Save buttons with a calm muted helper line naming the next thing to fix. No schema or main-process change.

**Tech Stack:** React 18, TypeScript, Mantine v7, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-sale-form-fixes-design.md` is authoritative.
- **Over-draw → red inline error + Save disabled** (never auto-cap). Message: `Only <available> kg available in this lot.` using the lot's real `available_kg`.
- **Vehicle is required** (10-char/free-text transport string); empty → Save disabled. Moved out of the "Optional" collapse, which is relabelled `Optional (e-way bill)`.
- **Buyer details are read-only on this screen** — GSTIN + billing address shown as text with a muted note "To edit these, open the Customers screen." No inline editing; buyer is chosen from existing customers only.
- **Plain English** for every message on this screen (see spec §5). Exact strings:
  - `Please choose a buyer.`
  - `Enter the vehicle number.`
  - `Tick at least one stock lot, then enter its quantity and selling rate.`
  - `Enter a quantity.`
  - `Enter a selling rate.`
  - `Only <n> kg available in this lot.`
- No schema change, no main-process logic change; the existing main-process draw-down guard stays as a backstop. The red top `Alert` is reserved for an actual save-time exception.
- Renderer reaches data only via `window.api.*`. Build stays green each task (`npm test` + `npm run typecheck` + `npm run build`). Do NOT run `npm run dev` headless.

---

## File Structure

- `src/renderer/lib/sale-validation.ts` *(new)* — pure helpers `lotDrawError`, `saleFormError` + the `LotDraw` / `SaleFormState` interfaces. No React, no `window.api`.
- `tests/renderer/sale-validation.test.ts` *(new)* — Vitest unit tests for both helpers.
- `src/renderer/screens/NewSale.tsx` *(modify)* — consume the helpers; vehicle required + visible; per-row over-draw error; read-only buyer block; Save gating + muted helper line.

---

## Task 1: Pure validation helper + tests

**Files:**
- Create: `src/renderer/lib/sale-validation.ts`
- Test: `tests/renderer/sale-validation.test.ts`

**Interfaces:**
- Produces (consumed by Task 2):
  - `interface LotDraw { include: boolean; qty: number; rate: number; available: number }`
  - `interface SaleFormState { hasBuyer: boolean; vehicle: string; lots: LotDraw[] }`
  - `function lotDrawError(d: LotDraw): string` — per-lot message; `''` when ok or not included.
  - `function saleFormError(s: SaleFormState): string` — whole-form reason; `''` when saveable.

- [ ] **Step 1: Write the failing tests** (create `tests/renderer/sale-validation.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { lotDrawError, saleFormError } from '../../src/renderer/lib/sale-validation'

const lot = (o: Partial<{ include: boolean; qty: number; rate: number; available: number }> = {}) =>
  ({ include: true, qty: 10, rate: 5, available: 100, ...o })

describe('lotDrawError', () => {
  it('returns empty when the lot is not included', () => {
    expect(lotDrawError(lot({ include: false, qty: 9999 }))).toBe('')
  })
  it('flags a missing quantity', () => {
    expect(lotDrawError(lot({ qty: 0 }))).toBe('Enter a quantity.')
  })
  it('flags an over-draw with the available amount', () => {
    expect(lotDrawError(lot({ qty: 150, available: 100 }))).toBe('Only 100 kg available in this lot.')
  })
  it('flags a missing rate once qty is within range', () => {
    expect(lotDrawError(lot({ qty: 50, rate: 0 }))).toBe('Enter a selling rate.')
  })
  it('returns empty for a valid included lot', () => {
    expect(lotDrawError(lot({ qty: 50, rate: 8, available: 100 }))).toBe('')
  })
  it('allows drawing exactly the available amount', () => {
    expect(lotDrawError(lot({ qty: 100, available: 100, rate: 8 }))).toBe('')
  })
})

describe('saleFormError', () => {
  const okForm = () => ({ hasBuyer: true, vehicle: 'GJ-05-AB-1234', lots: [lot({ qty: 50, rate: 8 })] })

  it('requires a buyer first', () => {
    expect(saleFormError({ ...okForm(), hasBuyer: false })).toBe('Please choose a buyer.')
  })
  it('requires a vehicle number', () => {
    expect(saleFormError({ ...okForm(), vehicle: '   ' })).toBe('Enter the vehicle number.')
  })
  it('requires at least one ticked lot with a quantity', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ include: false })] }))
      .toBe('Tick at least one stock lot, then enter its quantity and selling rate.')
  })
  it('surfaces an over-drawn lot', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ qty: 150, available: 100, rate: 8 })] }))
      .toBe('Only 100 kg available in this lot.')
  })
  it('surfaces a missing rate on a ticked lot', () => {
    expect(saleFormError({ ...okForm(), lots: [lot({ qty: 50, rate: 0 })] }))
      .toBe('Enter a selling rate.')
  })
  it('returns empty for a fully valid form', () => {
    expect(saleFormError(okForm())).toBe('')
  })
})
```

- [ ] **Step 2: Run the tests, verify they fail**

Run: `npx vitest run tests/renderer/sale-validation.test.ts`
Expected: FAIL — cannot resolve `../../src/renderer/lib/sale-validation` (module not created yet).

- [ ] **Step 3: Implement the helper** (create `src/renderer/lib/sale-validation.ts`)

```ts
// Pure save-gating logic for the New Sale screen. No React, no window.api — unit-tested.

/** One lot row's draw, paired with how much stock that lot still has. */
export interface LotDraw {
  include: boolean
  qty: number
  rate: number
  available: number
}

/** The whole sale form's gateable state. `lots` is every visible lot; helpers filter to the ticked ones. */
export interface SaleFormState {
  hasBuyer: boolean
  vehicle: string
  lots: LotDraw[]
}

/** Per-lot message for a ticked row. Empty string means the row is fine (or not ticked). */
export function lotDrawError(d: LotDraw): string {
  if (!d.include) return ''
  if (d.qty <= 0) return 'Enter a quantity.'
  if (d.qty > d.available) return `Only ${d.available} kg available in this lot.`
  if (d.rate <= 0) return 'Enter a selling rate.'
  return ''
}

/** Whole-form gate: a single plain-English reason Save is off, or '' when the form may be saved. */
export function saleFormError(s: SaleFormState): string {
  if (!s.hasBuyer) return 'Please choose a buyer.'
  if (!s.vehicle.trim()) return 'Enter the vehicle number.'
  const ticked = s.lots.filter(l => l.include && l.qty > 0)
  if (ticked.length === 0) return 'Tick at least one stock lot, then enter its quantity and selling rate.'
  for (const l of s.lots) {
    const e = lotDrawError(l)
    if (e) return e
  }
  return ''
}
```

- [ ] **Step 4: Run the tests, verify they pass**

Run: `npx vitest run tests/renderer/sale-validation.test.ts`
Expected: PASS (12 assertions across both describes).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: green (existing 93 + the new file's tests).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/lib/sale-validation.ts tests/renderer/sale-validation.test.ts
git commit -m "feat: pure sale-validation helpers (lotDrawError, saleFormError)"
```

---

## Task 2: Wire validation into NewSale (vehicle required, live over-draw, read-only buyer, Save gating)

**Files:**
- Modify: `src/renderer/screens/NewSale.tsx`
- Test: none (verify via typecheck + suite + build; logic is covered by Task 1)

**Interfaces:**
- Consumes from Task 1: `lotDrawError`, `saleFormError`, and the `LotDraw` shape (`{ include, qty, rate, available }`).

Context for the implementer — current `NewSale.tsx` facts you will build on:
- Vehicle state: `const [vehicle, setVehicle] = useState('')` (line ~34); the Vehicle `TextInput` currently lives inside `<Collapse in={showOptional}>` (line ~131) alongside the e-way bill fields, behind a button labelled `Optional (e-way bill, vehicle)` (line ~123).
- The buyer is chosen by a searchable `Select` (line ~109-115); `const buyer = customers.find(...)` (line ~52); `placeOfSupply` + `intra` are already derived (lines ~53-54) and a place-of-supply hint already renders when `buyer` is set (lines ~117-121).
- Each lot row renders in the `lots.map(l => …)` table body (lines ~153-178); `const d = draw[l.purchase_id] ?? { include:false, qty:0, rate:0 }` and the Qty `MoneyInput` is rendered in its own `Table.Td` (lines ~172-174). The lot's available stock is `l.available_kg`.
- `save(thenInvoice)` (lines ~75-95) already has guard `if (!buyer)…`, `if (lines.length === 0)…`, `if (lines.some(l => l.rate_per_kg <= 0))…`, then builds `payload` and calls the api. The two footer buttons call `save(false)` and `save(true)` (lines ~215-216). A top `Alert` shows `error` (line ~101).

- [ ] **Step 1: Import the helpers**

Add to the imports near the top of `src/renderer/screens/NewSale.tsx`:

```ts
import { lotDrawError, saleFormError } from '../lib/sale-validation'
```

- [ ] **Step 2: Compute the form error from current state**

After the `lines`/`tax`/`rows` derivations and before `save`, add a mapping of all visible lots to `LotDraw` and the single form-level error:

```ts
  const lotDraws = lots.map(l => {
    const d = draw[l.purchase_id] ?? { include: false, qty: 0, rate: 0 }
    return { include: d.include, qty: d.qty, rate: d.rate, available: l.available_kg }
  })
  const formError = saleFormError({ hasBuyer: !!buyer, vehicle, lots: lotDraws })
```

- [ ] **Step 3: Move Vehicle out of the collapse and make it required**

(a) Relabel the collapse toggle button (the line rendering `{showOptional ? '▾' : '▸'} Optional (e-way bill, vehicle)`):

```tsx
          {showOptional ? '▾' : '▸'} Optional (e-way bill)
```

(b) Remove the Vehicle `TextInput` from inside `<Collapse in={showOptional}>` (the collapse keeps only the two e-way bill fields):

```tsx
          <Group grow align="flex-start" mt="xs">
            <TextInput label="E-way bill no." value={ewayNo} onChange={e => setEwayNo(e.currentTarget.value)} />
            <Input.Wrapper label="E-way bill date">
              <DateField value={ewayDate} onChange={setEwayDate} />
            </Input.Wrapper>
          </Group>
```

(c) Add the Vehicle field, required, to the always-visible top `Group` that holds Invoice number / Invoice date / Buyer (the `<Group grow align="flex-start" mb="sm">` near line 104). Append it after the Buyer `Select`:

```tsx
          <TextInput
            label="Vehicle"
            withAsterisk
            value={vehicle}
            onChange={e => setVehicle(e.currentTarget.value)}
            placeholder="By Taxi / By Van / GJ-05-…"
            error={vehicle.trim() ? undefined : 'Enter the vehicle number.'}
          />
```

- [ ] **Step 4: Show the chosen buyer's details read-only**

Replace the existing buyer hint block (the `{buyer && ( <Text size="sm" c="dimmed" mb="xs">Place of supply: …</Text> )}` at lines ~117-121) with a read-only details block that keeps the place-of-supply line and adds GSTIN + billing address:

```tsx
        {buyer && (
          <Paper withBorder p="sm" radius="sm" mb="xs" bg="var(--mantine-color-gray-0)">
            <Text size="sm">GSTIN: <Text component="span" fw={600}>{buyer.gstin || '—'}</Text></Text>
            <Text size="sm">
              Address: {[buyer.billing_address, buyer.billing_city, buyer.billing_state].filter(Boolean).join(', ')}
              {buyer.billing_pincode ? ` — ${buyer.billing_pincode}` : ''}
            </Text>
            <Text size="sm">
              Place of supply: <Text component="span" fw={700}>{placeOfSupply || '—'}</Text> → {intra ? 'CGST + SGST' : 'IGST'}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>To edit these, open the Customers screen.</Text>
          </Paper>
        )}
```

- [ ] **Step 5: Show the per-lot over-draw error live**

In the lot row's Qty `Table.Td` (the cell rendering `{d.include ? <MoneyInput value={d.qty} … /> : '—'}`), render the per-lot error under the input when the lot is ticked. First, compute the row's error once at the top of the `lots.map(l => { … })` body, right after `const d = draw[l.purchase_id] ?? …` and `const amt = …`:

```tsx
              const rowErr = lotDrawError({ include: d.include, qty: d.qty, rate: d.rate, available: l.available_kg })
```

Then replace that Qty cell's contents with:

```tsx
                  <Table.Td style={{ textAlign: 'right' }}>
                    {d.include ? (
                      <>
                        <MoneyInput value={d.qty} onChange={n => setLine(l.purchase_id, { qty: n })} />
                        {rowErr && <Text c="red" size="xs" mt={4}>{rowErr}</Text>}
                      </>
                    ) : '—'}
                  </Table.Td>
```

- [ ] **Step 6: Gate the Save buttons + show a calm helper line**

Replace the footer button `Group` (lines ~213-217) so both buttons are disabled when `formError` is non-empty and a muted helper line names the next thing to fix:

```tsx
        <Group justify="flex-end" align="center" mt="md">
          {formError && <Text size="sm" c="dimmed" mr="auto">{formError}</Text>}
          <Button variant="default" onClick={() => nav('/sales')}>Cancel</Button>
          <Button disabled={!!formError} onClick={() => save(false)}>Save</Button>
          <Button disabled={!!formError} onClick={() => save(true)}>Save &amp; preview PDF</Button>
        </Group>
```

- [ ] **Step 7: Simplify the save() guards (keep a backstop)**

In `save(thenInvoice)`, the new gate prevents reaching `save` while invalid, but keep a minimal backstop. Replace the three leading `if (!buyer) … / if (lines.length === 0) … / if (lines.some(...)) …` guards with a single guard off the shared helper, so the wording can never drift from the buttons:

```ts
    setError('')
    const fe = saleFormError({ hasBuyer: !!buyer, vehicle, lots: lotDraws })
    if (fe) { setError(fe); return }
```

(Leave the rest of `save` — the `payload` build and the `window.api` call inside `try/catch` — unchanged. `buyer` is guaranteed non-null past this guard because `saleFormError` returns non-empty when `!hasBuyer`; if TypeScript still narrows `buyer` as possibly null in the payload, add `if (!buyer) return` immediately after the guard as a type-narrowing no-op.)

- [ ] **Step 8: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. Manual check (deferred to operator): blank vehicle disables Save and the helper line reads "Enter the vehicle number."; ticking a lot and typing more than its available kg turns that row's message red ("Only N kg available in this lot.") and disables Save; selecting a buyer shows their GSTIN + address read-only with the "open the Customers screen" note; e-way bill stays under the renamed "Optional (e-way bill)" toggle.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/screens/NewSale.tsx
git commit -m "feat: sale form — vehicle required, live over-draw error, read-only buyer, Save gating"
```

---

## Notes for the implementer

- `available` in `LotDraw` is the lot's `available_kg` (already on each `AvailableLot`). Drawing *exactly* the available amount is allowed; only `qty > available` errors.
- Do not change `computeSaleTax`, the `lines` derivation, the `payload`, numbering, or any `window.api` call — this round is presentation + gating only.
- The red top `Alert` (`error` state) is now only populated by a thrown main-process exception in `save`'s `catch` (and the one backstop guard); it is not the primary way the user learns what's missing — the disabled buttons + muted helper line + inline field errors are.
- Buyer details are display-only here; the buyer record is still read from `customers` and sent in the payload exactly as before.
