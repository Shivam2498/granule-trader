# Purchase Form Refinement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the purchase form rate-driven (Quantity × Rate/kg = Taxable amount, reactive), give the supplier a structured pincode-driven address, and add per-field mandatory validation.

**Architecture:** Add `rate_per_kg` + supplier address columns to `purchases` (idempotent migration); the core computes `amount = round2(qty × rate)` authoritatively; the form is rewritten with a read-only computed amount, `PincodeField`/`StateSelect` supplier address, and inline validation. Sequenced so the build stays green after each task.

**Tech Stack:** Electron, React 18, TypeScript, better-sqlite3, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-purchase-form-refinement-design.md` is authoritative.
- **Build stays green every task:** after each task, `npm test` + `npm run typecheck` + `npm run build` all pass. Task 1 keeps `NewPurchase.amount` optional for backward compatibility so the unchanged form still compiles; Task 2 switches the form to send `rate_per_kg`.
- **Amount is derived:** `amount = round2(qty_kg × rate_per_kg)` when `rate_per_kg > 0`, computed in the core; the UI's amount is display-only. Tax (`computeTax`) is computed on this derived amount.
- **Migration:** idempotent `ALTER TABLE ADD COLUMN`, guarded by the existing `hasColumn(db, table, col)` helper in `schema.ts`; backfill legacy rows.
- **Mandatory fields (inline error each, Save disabled until valid):** our code, invoice date, supplier name, supplier state, HSN, quantity (> 0), rate (> 0). Optional: supplier invoice no., city, pincode, street address, round-off, TCS, payment date.
- **Money via `round2`.** Renderer data only via `window.api.*`.
- **TDD:** failing test first for the core/migration; the form is verified by typecheck + the suite staying green (do NOT run `npm run dev` headless).

---

## File Structure

- `src/main/db/schema.ts` — add 4 columns to `purchases` in `SCHEMA_SQL` + 4 `ALTER TABLE`/backfill lines in `migrate()`.
- `src/shared/types.ts` — `Purchase` gains `rate_per_kg`, `party_city`, `party_pincode`, `party_address`.
- `src/main/core/purchase.ts` — `NewPurchase` gains `rate_per_kg?` + 3 address fields (keeps `amount?` optional); `createPurchase`/`updatePurchase` derive `amount` and store the new columns.
- `tests/core/purchase.test.ts`, `tests/db/schema.test.ts` — extend.
- `src/renderer/screens/PurchaseForm.tsx` — rewrite (Task 2).

---

## Task 1: Data model + core (rate-driven amount, supplier address, migration)

**Files:**
- Modify: `src/main/db/schema.ts`, `src/shared/types.ts`, `src/main/core/purchase.ts`
- Test: `tests/core/purchase.test.ts`, `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: `computeTax`, `round2`, `hasColumn` (existing in schema.ts).
- Produces:
  - `Purchase` gains `rate_per_kg: number`, `party_city: string`, `party_pincode: string`, `party_address: string`.
  - `NewPurchase` gains `rate_per_kg?: number`, `party_city?: string`, `party_pincode?: string`, `party_address?: string` (keeps `amount?: number` optional).
  - `createPurchase`/`updatePurchase` derive `amount = round2(qty_kg × rate_per_kg)` when `rate_per_kg > 0`, else fall back to `round2(input.amount ?? 0)`; store `rate_per_kg` + the address fields.

- [ ] **Step 1: Add the schema columns + migration**

In `src/main/db/schema.ts`, inside the `purchases` CREATE TABLE in `SCHEMA_SQL`, add these columns right after the `party_state` line:
```sql
  party_city TEXT NOT NULL DEFAULT '',
  party_pincode TEXT NOT NULL DEFAULT '',
  party_address TEXT NOT NULL DEFAULT '',
```
and add `rate_per_kg REAL NOT NULL DEFAULT 0,` right after the `qty_remaining_kg` line.

In the `migrate(db)` function, append (after the existing sale_allocations block):
```ts
  for (const [col, ddl] of [
    ['rate_per_kg', `ALTER TABLE purchases ADD COLUMN rate_per_kg REAL NOT NULL DEFAULT 0`],
    ['party_city', `ALTER TABLE purchases ADD COLUMN party_city TEXT NOT NULL DEFAULT ''`],
    ['party_pincode', `ALTER TABLE purchases ADD COLUMN party_pincode TEXT NOT NULL DEFAULT ''`],
    ['party_address', `ALTER TABLE purchases ADD COLUMN party_address TEXT NOT NULL DEFAULT ''`]
  ] as const) {
    if (!hasColumn(db, 'purchases', col)) db.exec(ddl)
  }
  // Backfill a rate for legacy purchases that have an amount but no rate
  db.exec(`UPDATE purchases SET rate_per_kg = round(amount / qty_kg, 2) WHERE rate_per_kg = 0 AND qty_kg > 0 AND amount > 0`)
```

- [ ] **Step 2: Write the failing migration + core tests**

In `tests/db/schema.test.ts`, add:
```ts
it('migrates a legacy purchases table to add rate_per_kg + supplier address', () => {
  const db = new Database(':memory:')
  db.exec(`CREATE TABLE purchases (id INTEGER PRIMARY KEY AUTOINCREMENT, our_code TEXT, supplier_invoice_number TEXT, invoice_date TEXT, party TEXT, party_state TEXT, hsn_code TEXT, qty_kg REAL, qty_remaining_kg REAL, amount REAL, cgst REAL, sgst REAL, igst REAL, tcs REAL, roundoff REAL, total_invoice_amount REAL, payment_status TEXT, payment_date TEXT, fy_label TEXT, code_seq INTEGER, created_at TEXT)`)
  db.prepare(`INSERT INTO purchases (qty_kg, amount, fy_label, code_seq, invoice_date, qty_remaining_kg) VALUES (100, 5000, '2024-25', 1, '2024-05-01', 100)`).run()
  initSchema(db)
  const cols = (db.prepare("PRAGMA table_info(purchases)").all() as any[]).map(c => c.name)
  for (const c of ['rate_per_kg','party_city','party_pincode','party_address']) expect(cols).toContain(c)
  const row = db.prepare('SELECT rate_per_kg FROM purchases WHERE id = 1').get() as { rate_per_kg: number }
  expect(row.rate_per_kg).toBe(50)   // 5000 / 100 backfilled
  db.close()
})
```
(The file already imports `Database` and `initSchema` from the sale_allocations migration test; reuse those imports.)

In `tests/core/purchase.test.ts`, the `base` object currently passes `amount`. Add a test that proves rate-driven amount, and update the existing intra-state amount expectation to the rate form. Add:
```ts
it('derives amount from quantity x rate and stores rate + address', () => {
  const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01',
    qty_kg: 1000, rate_per_kg: 50, party_city: 'Surat', party_pincode: '395003', party_address: 'GIDC' })
  expect(p.amount).toBe(50000)            // 1000 * 50
  expect(p.rate_per_kg).toBe(50)
  expect(p.party_city).toBe('Surat')
  expect(p.cgst).toBe(4500)               // 9% of 50000 intra-state
  expect(p.total_invoice_amount).toBe(59000)
})
```
Keep the existing `base` object (with its `amount`) for the other tests — they still pass via the `amount` fallback. (`base` does not set `rate_per_kg`, so those purchases use `amount` directly.)

- [ ] **Step 3: Run the tests, verify they fail**

Run: `npx vitest run tests/db/schema.test.ts tests/core/purchase.test.ts`
Expected: FAIL — `Purchase`/`NewPurchase` lack the new fields and the migration columns don't exist yet.

- [ ] **Step 4: Update the types** (`src/shared/types.ts`)

In `Purchase`, add after `party_state`:
```ts
  party_city: string
  party_pincode: string
  party_address: string
```
and add `rate_per_kg: number` after `qty_remaining_kg`.

- [ ] **Step 5: Update `NewPurchase` + core** (`src/main/core/purchase.ts`)

Change the `NewPurchase` interface to:
```ts
export interface NewPurchase {
  our_code: string; supplier_invoice_number: string; invoice_date: string
  party: string; party_state: string; hsn_code: string
  party_city?: string; party_pincode?: string; party_address?: string
  qty_kg: number; rate_per_kg?: number; amount?: number; gst_rate: number; homeState: string
  igst_manual?: number; tcs?: number; roundoff?: number
  payment_status?: 'pending' | 'done'; payment_date?: string | null
}
```

In `createPurchase`, compute the derived amount before `computeTax` and use it; add a small helper above the function:
```ts
function derivedAmount(input: NewPurchase): number {
  return input.rate_per_kg && input.rate_per_kg > 0
    ? round2(input.qty_kg * input.rate_per_kg)
    : round2(input.amount ?? 0)
}
```
In `createPurchase`: replace `amount: input.amount` in the `computeTax` call with `amount: derivedAmount(input)`. Add to the INSERT column list (after `hsn_code,`): `party_city, party_pincode, party_address,` and (after `qty_remaining_kg,`): `rate_per_kg,`. Add matching `@`-placeholders, and in the `.run({...})` object add:
```ts
    party_city: input.party_city ?? '', party_pincode: input.party_pincode ?? '', party_address: input.party_address ?? '',
    rate_per_kg: round2(input.rate_per_kg ?? 0),
```

In `updatePurchase`: replace `amount: input.amount` in the `computeTax` call with `amount: derivedAmount(input)`. Add to the UPDATE SET clause: `party_city=@pc, party_pincode=@pp, party_address=@pa, rate_per_kg=@rpk,` and to the `.run({...})` object add:
```ts
    pc: input.party_city ?? existing.party_city, pp: input.party_pincode ?? existing.party_pincode,
    pa: input.party_address ?? existing.party_address, rpk: round2(input.rate_per_kg ?? 0),
```

- [ ] **Step 6: Run the tests, verify they pass**

Run: `npx vitest run tests/db/schema.test.ts tests/core/purchase.test.ts`
Expected: PASS.

- [ ] **Step 7: Full suite + typecheck + build**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green. The unchanged `PurchaseForm.tsx` still compiles (it sends `amount`, which is now optional and used via the fallback).

- [ ] **Step 8: Commit**

```bash
git add src/main/db/schema.ts src/shared/types.ts src/main/core/purchase.ts tests/core/purchase.test.ts tests/db/schema.test.ts
git commit -m "feat: purchase rate_per_kg (amount = qty x rate) + supplier address columns + migration"
```

---

## Task 2: Purchase form — reactive amount, structured address, validation

**Files:**
- Modify: `src/renderer/screens/PurchaseForm.tsx` (rewrite)
- Test: none (visual; verify via typecheck + suite)

**Interfaces:**
- Consumes: `window.api.listPurchases/nextPurchaseCode/createPurchase/updatePurchase/getSettings/listHsn`; `computeTax` (`@shared/tax`); `isPincode` (`@shared/validation`); `MoneyInput`, `SignedMoneyInput`, `StateSelect`, `PincodeField`, `FormPage`, `FormSection`, `TaxSummary`; `formatINR`, `today`.
- Sends `NewPurchase` with `rate_per_kg` + `party_city`/`party_pincode`/`party_address` (no `amount`).

- [ ] **Step 1: Replace `src/renderer/screens/PurchaseForm.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { HsnProduct, Settings } from '@shared/types'
import { computeTax } from '@shared/tax'
import { isPincode } from '@shared/validation'
import MoneyInput from '../components/MoneyInput'
import SignedMoneyInput from '../components/SignedMoneyInput'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import TaxSummary from '../components/TaxSummary'
import { formatINR, today } from '../lib/format'

export default function PurchaseForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [form, setForm] = useState({
    our_code: '', supplier_invoice_number: '', invoice_date: today(),
    party: '', party_state: '', party_city: '', party_pincode: '', party_address: '',
    hsn_code: '', qty_kg: 0, rate_per_kg: 0, roundoff: 0, tcs: 0,
    payment_status: 'pending' as 'pending' | 'done', payment_date: '' as string
  })
  const [error, setError] = useState('')
  const set = (p: Partial<typeof form>) => setForm(f => ({ ...f, ...p }))

  useEffect(() => { (async () => {
    try {
      setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn())
      if (editId) {
        const p = (await window.api.listPurchases()).find(x => x.id === editId)
        if (p) setForm({
          our_code: p.our_code, supplier_invoice_number: p.supplier_invoice_number, invoice_date: p.invoice_date,
          party: p.party, party_state: p.party_state, party_city: p.party_city, party_pincode: p.party_pincode, party_address: p.party_address,
          hsn_code: p.hsn_code, qty_kg: p.qty_kg,
          rate_per_kg: p.rate_per_kg > 0 ? p.rate_per_kg : (p.qty_kg > 0 ? Math.round((p.amount / p.qty_kg) * 100) / 100 : 0),
          roundoff: p.roundoff, tcs: p.tcs, payment_status: p.payment_status, payment_date: p.payment_date ?? ''
        })
      }
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [editId])

  useEffect(() => { if (!editId) window.api.nextPurchaseCode(form.invoice_date).then(c => setForm(f => ({ ...f, our_code: c }))) }, [form.invoice_date, editId])

  if (!settings) return <FormPage title="Purchase" onBack={() => nav('/purchases')} footer={null}><p>Loading…</p></FormPage>

  const amount = Math.round((form.qty_kg * form.rate_per_kg + Number.EPSILON) * 100) / 100
  const gstRate = hsn.find(h => h.hsn_code === form.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const tax = computeTax({ amount, gstRate, placeOfSupplyState: form.party_state, homeState: settings.home_state, tcs: form.tcs, roundoff: form.roundoff })
  const intra = tax.igst === 0
  const rows = [
    { label: `CGST ${intra ? gstRate / 2 : 0}%`, value: tax.cgst },
    { label: `SGST ${intra ? gstRate / 2 : 0}%`, value: tax.sgst },
    { label: `IGST ${intra ? 0 : gstRate}%`, value: tax.igst },
    { label: 'TCS', value: tax.tcs }
  ]

  const errs = {
    our_code: form.our_code.trim() ? '' : 'Required',
    invoice_date: form.invoice_date ? '' : 'Required',
    party: form.party.trim() ? '' : 'Required',
    party_state: form.party_state.trim() ? '' : 'Required',
    hsn_code: form.hsn_code ? '' : 'Required',
    qty_kg: form.qty_kg > 0 ? '' : 'Enter a quantity',
    rate_per_kg: form.rate_per_kg > 0 ? '' : 'Enter a rate',
    party_pincode: !form.party_pincode || isPincode(form.party_pincode) ? '' : '6-digit pincode'
  }
  const valid = Object.values(errs).every(e => e === '')

  async function save() {
    setError('')
    if (!valid) { setError('Please fix the highlighted fields.'); return }
    try {
      const payload = {
        our_code: form.our_code, supplier_invoice_number: form.supplier_invoice_number, invoice_date: form.invoice_date,
        party: form.party, party_state: form.party_state, party_city: form.party_city, party_pincode: form.party_pincode, party_address: form.party_address,
        hsn_code: form.hsn_code, qty_kg: form.qty_kg, rate_per_kg: form.rate_per_kg,
        gst_rate: gstRate, homeState: settings!.home_state, roundoff: form.roundoff, tcs: form.tcs,
        payment_status: form.payment_status, payment_date: form.payment_status === 'done' ? (form.payment_date || today()) : null
      }
      if (editId) await window.api.updatePurchase(editId, payload); else await window.api.createPurchase(payload)
      nav('/purchases')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  const F = (label: string, node: React.ReactNode, err?: string) => (
    <div className="field"><label>{label}</label>{node}{err ? <div className="err">{err}</div> : null}</div>
  )

  return (
    <FormPage title={editId ? 'Edit purchase' : 'Add purchase'} onBack={() => nav('/purchases')} error={error}
      footer={<><button onClick={() => nav('/purchases')}>Cancel</button><button className="primary" disabled={!valid} onClick={save}>{editId ? 'Update purchase' : 'Save purchase'}</button></>}>
      <FormSection title="Invoice">
        {F('Our code', <input value={form.our_code} onChange={e => set({ our_code: e.target.value })} />, errs.our_code)}
        {F('Supplier invoice no.', <input value={form.supplier_invoice_number} onChange={e => set({ supplier_invoice_number: e.target.value })} />)}
        {F('Invoice date', <input type="date" value={form.invoice_date} onChange={e => set({ invoice_date: e.target.value })} />, errs.invoice_date)}
        {F('HSN', <select value={form.hsn_code} onChange={e => set({ hsn_code: e.target.value })}>
            <option value="">— select —</option>{hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
          </select>, errs.hsn_code)}
      </FormSection>
      <FormSection title="Supplier">
        {F('Supplier name', <input value={form.party} onChange={e => set({ party: e.target.value })} />, errs.party)}
        {F('Pincode', <PincodeField value={form.party_pincode} onChange={v => set({ party_pincode: v })}
            onResolved={r => set({ party_city: r.city, party_state: r.state })} />, errs.party_pincode)}
        {F('City', <input value={form.party_city} onChange={e => set({ party_city: e.target.value })} />)}
        {F('State', <StateSelect value={form.party_state} onChange={v => set({ party_state: v })} />, errs.party_state)}
        {F('Street address', <textarea rows={2} value={form.party_address} onChange={e => set({ party_address: e.target.value })} />)}
      </FormSection>
      <FormSection title="Amounts">
        {F('Quantity (kg)', <MoneyInput value={form.qty_kg} onChange={n => set({ qty_kg: n })} />, errs.qty_kg)}
        {F('Rate per kg', <MoneyInput value={form.rate_per_kg} onChange={n => set({ rate_per_kg: n })} />, errs.rate_per_kg)}
        {F('Taxable amount', <input readOnly value={formatINR(amount)} />)}
        {F('Round off (can be negative)', <SignedMoneyInput value={form.roundoff} onChange={n => set({ roundoff: n })} />)}
        {F('TCS', <MoneyInput value={form.tcs} onChange={n => set({ tcs: n })} />)}
        {F('Payment', <select value={form.payment_status} onChange={e => set({ payment_status: e.target.value as 'pending' | 'done' })}>
            <option value="pending">Pending</option><option value="done">Done</option></select>)}
        {form.payment_status === 'done' && F('Payment date', <input type="date" value={form.payment_date || today()} onChange={e => set({ payment_date: e.target.value })} />)}
      </FormSection>
      <div className="section"><h3>Tax</h3><div className="divider" /><TaxSummary taxable={tax.taxable_amount} rows={rows} total={tax.total} /></div>
    </FormPage>
  )
}
```

- [ ] **Step 2: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. (Do NOT run `npm run dev`.)

- [ ] **Step 3: Commit**

```bash
git add src/renderer/screens/PurchaseForm.tsx
git commit -m "feat: purchase form — rate-driven reactive amount, structured supplier address, inline validation"
```

---

## Notes for the implementer

- The taxable amount field is **read-only** and shows `formatINR(qty × rate)`; it recomputes on every render, so changing quantity or rate updates the amount and the whole tax summary live.
- The core is the source of truth for `amount`; the form sends `rate_per_kg`, never `amount`.
- Editing a legacy purchase (stored before this round) shows a rate back-derived from `amount ÷ qty` (the migration also backfills `rate_per_kg`, so this is belt-and-suspenders).
- For any unexpected test failure that isn't a one-line fix, use the systematic-debugging skill.
