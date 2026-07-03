# Purchase Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-time, local, dry-run-first CLI that imports historical purchases from a CSV export into a Granule Trader `.db`, preserving the sheet's tax figures and keeping each lot's item description.

**Architecture:** A per-purchase `description` column is added to the schema and surfaced in the app. A pure ESM helpers module parses/validates/maps CSV rows; a DB module plans and commits the import against `better-sqlite3`; a thin CLI wires them together, writes log/skipped-row report files, and defaults to dry-run.

**Tech Stack:** Node ESM (`.mjs`), `better-sqlite3` (already a dependency), vitest. No new npm dependencies.

## Global Constraints

- Scripts are plain ESM `.mjs` (no build step). Before running any script or DB-backed test under Node: `npm run rebuild:node` (or use `npm test`, whose `pretest` does it).
- **Trust the sheet's tax numbers** — import `cgst/sgst/igst/tcs/roundoff/total_invoice_amount` verbatim; never recompute via `computeTax`.
- `round2(n)` is sign-symmetric: `Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100` (matches `src/shared/money.ts`).
- Dates are **`M/D/YYYY`**; each lot's financial year is derived from the parsed date.
- Dedup key for purchases: **`(fy_label, code_seq)`**.
- Migrated purchases: `payment_status = 'done'`, `payment_date = null`.
- Suppliers are created **by name only** (other fields blank).
- Reuse the existing `parseCsv` exported from `scripts/customer-import.mjs`; do not write a second CSV parser.

---

### Task 1: Add `description` column to `purchases`

**Files:**
- Modify: `src/main/db/schema.ts` (base `CREATE TABLE purchases` + the additive-migration loop)
- Test: `tests/db/purchase-description.test.ts` (create)

**Interfaces:**
- Produces: a `purchases.description` column (`TEXT NOT NULL DEFAULT ''`) present on both fresh and migrated databases.

- [ ] **Step 1: Write the failing test**

Create `tests/db/purchase-description.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import Database from 'better-sqlite3'
import { openDatabase } from '../../src/main/db/connection'
import { initSchema } from '../../src/main/db/schema'

function hasCol(db: Database.Database, table: string, col: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).some(c => c.name === col)
}

describe('purchases.description column', () => {
  it('exists on a freshly created database', () => {
    const db = openDatabase(':memory:')
    expect(hasCol(db, 'purchases', 'description')).toBe(true)
  })

  it('is added by migration to a legacy purchases table that lacks it', () => {
    const db = new Database(':memory:')
    // Minimal legacy purchases table without `description`.
    db.exec(`CREATE TABLE purchases (
      id INTEGER PRIMARY KEY AUTOINCREMENT, our_code TEXT NOT NULL, invoice_date TEXT NOT NULL,
      qty_kg REAL NOT NULL, qty_remaining_kg REAL NOT NULL, fy_label TEXT NOT NULL, code_seq INTEGER NOT NULL
    )`)
    expect(hasCol(db, 'purchases', 'description')).toBe(false)
    initSchema(db)
    expect(hasCol(db, 'purchases', 'description')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run rebuild:node && npx vitest run tests/db/purchase-description.test.ts`
Expected: FAIL — `description` column absent.

- [ ] **Step 3: Add the column to the base table and the migration**

In `src/main/db/schema.ts`, inside the `CREATE TABLE IF NOT EXISTS purchases (...)` block, add a `description` line (e.g. immediately after the `hsn_code` line):

```sql
  hsn_code TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
```

Then, in `migrate()`, add `description` to the existing `purchases` additive-column loop array:

```typescript
  for (const [col, ddl] of [
    ['rate_per_kg', `ALTER TABLE purchases ADD COLUMN rate_per_kg REAL NOT NULL DEFAULT 0`],
    ['party_city', `ALTER TABLE purchases ADD COLUMN party_city TEXT NOT NULL DEFAULT ''`],
    ['party_pincode', `ALTER TABLE purchases ADD COLUMN party_pincode TEXT NOT NULL DEFAULT ''`],
    ['party_address', `ALTER TABLE purchases ADD COLUMN party_address TEXT NOT NULL DEFAULT ''`],
    ['supplier_id', `ALTER TABLE purchases ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)`],
    ['description', `ALTER TABLE purchases ADD COLUMN description TEXT NOT NULL DEFAULT ''`]
  ] as const) {
    if (!hasColumn(db, 'purchases', col)) db.exec(ddl)
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/db/purchase-description.test.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/db/schema.ts tests/db/purchase-description.test.ts
git commit -m "feat(schema): add per-purchase description column"
```

---

### Task 2: Persist `description` in core purchase create/update

**Files:**
- Modify: `src/shared/types.ts` (add `description` to `Purchase`)
- Modify: `src/main/core/purchase.ts` (`NewPurchase` interface; `createPurchase` and `updatePurchase` inserts)
- Test: `tests/core/purchase.test.ts` (add a case)

**Interfaces:**
- Consumes: `purchases.description` column (Task 1).
- Produces: `NewPurchase.description?: string`; `createPurchase`/`updatePurchase` store it; `Purchase.description: string` is returned by `getPurchase`.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/purchase.test.ts` inside `describe('createPurchase', ...)`:

`updatePurchase` is already imported at the top of `tests/core/purchase.test.ts`. Add:

```typescript
  it('stores a per-purchase description', () => {
    const p = createPurchase(db, { ...base, our_code: '0007/2425', invoice_date: '2024-05-01', description: 'Black M/B' })
    expect(p.description).toBe('Black M/B')
    const updated = updatePurchase(db, p.id, { ...base, our_code: '0007/2425', invoice_date: '2024-05-01', description: 'White M/B' })
    expect(updated.description).toBe('White M/B')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/core/purchase.test.ts -t "stores a per-purchase description"`
Expected: FAIL — `description` is `undefined` / not persisted.

- [ ] **Step 3: Add `description` to the type and both writes**

In `src/shared/types.ts`, add to `interface Purchase` (near `hsn_code`):

```typescript
  hsn_code: string
  description: string
```

In `src/main/core/purchase.ts`, add to `NewPurchase`:

```typescript
  qty_kg: number; rate_per_kg?: number; amount?: number; gst_rate: number; homeState: string
  description?: string
```

In `createPurchase`, add `description` to the `INSERT` column list, the `VALUES` list, and the params object:

```typescript
    INSERT INTO purchases (our_code, supplier_invoice_number, invoice_date, party, party_state, hsn_code,
      description, party_city, party_pincode, party_address,
      qty_kg, qty_remaining_kg, rate_per_kg, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
      payment_status, payment_date, fy_label, code_seq, supplier_id)
    VALUES (@our_code, @supplier_invoice_number, @invoice_date, @party, @party_state, @hsn_code,
      @description, @party_city, @party_pincode, @party_address,
      @qty_kg, @qty_remaining_kg, @rate_per_kg, @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount,
      @payment_status, @payment_date, @fy_label, @code_seq, @supplier_id)
```

and in that same params object:

```typescript
    hsn_code: input.hsn_code,
    description: input.description ?? '',
```

In `updatePurchase`, add `description=@description` to the `SET` clause and `description: input.description ?? existing.description` to the params object:

```typescript
    party=@party, party_state=@ps, hsn_code=@hsn, description=@description,
```
```typescript
    party: input.party, ps: input.party_state, hsn: input.hsn_code, description: input.description ?? existing.description,
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/core/purchase.test.ts`
Expected: PASS (all purchase tests, including the new one).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/core/purchase.ts tests/core/purchase.test.ts
git commit -m "feat(purchase): persist per-purchase description"
```

---

### Task 3: Surface `description` in the Purchase form and list

**Files:**
- Modify: `src/renderer/screens/PurchaseForm.tsx` (add a Description input + include it in load/save)
- Modify: `src/renderer/screens/Purchases.tsx` (show a Description column)

**Interfaces:**
- Consumes: `NewPurchase.description` (Task 2), `Purchase.description` (Task 2).

Note: this task is trivial controlled-input wiring; it is verified by typecheck + the full existing test suite + a production build rather than a new unit test (the persistence path is already covered by Task 2).

- [ ] **Step 1: Add `description` to the form state, load, save, and a field**

In `src/renderer/screens/PurchaseForm.tsx`, add `description: ''` to the `useForm` `initialValues`:

```typescript
      hsn_code: '', description: '', qty_kg: 0, rate_per_kg: 0, roundoff: 0, tcs: 0,
```

In the edit-load `form.setValues({...})`, add:

```typescript
          hsn_code: p.hsn_code, description: p.description ?? '', qty_kg: p.qty_kg,
```

In `handleSave`'s `payload`, add:

```typescript
        hsn_code: v.hsn_code, description: v.description, qty_kg: v.qty_kg, rate_per_kg: v.rate_per_kg,
```

In the `Invoice` `FormSection`, add a Description input after the HSN `Select`:

```tsx
        <TextInput label="Description / item" placeholder="e.g. Black M/B" {...form.getInputProps('description')} />
```

- [ ] **Step 2: Show description in the Purchases list**

In `src/renderer/screens/Purchases.tsx`, add a header cell after `HSN` in the `ListTable` `head`:

```tsx
<Table.Th>HSN</Table.Th><Table.Th>Item</Table.Th>
```

Add a matching body cell after the `hsn_code` cell (and bump the two `colSpan={9}` values in this file to `10` — the month-group header row and the empty-state row):

```tsx
<Table.Td>{p.hsn_code}</Table.Td><Table.Td>{p.description}</Table.Td>
```

- [ ] **Step 3: Verify typecheck, tests, and build**

Run: `npm run typecheck && npm test && npm run build`
Expected: typecheck clean; all tests pass; build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/screens/PurchaseForm.tsx src/renderer/screens/Purchases.tsx
git commit -m "feat(purchase-ui): show and edit per-purchase description"
```

---

### Task 4: Pure primitives in `scripts/purchase-import.mjs`

**Files:**
- Create: `scripts/purchase-import.mjs`
- Test: `tests/scripts/purchase-import.test.mjs` (create)

**Interfaces:**
- Produces (all pure, no DB):
  - `cleanNumber(s) → number` — strips commas/₹; `''`→`0`; non-numeric→`NaN`.
  - `parseDateMDY(s) → 'YYYY-MM-DD' | null` — parses `M/D/YYYY`, rejects invalid calendar dates.
  - `fyFromDate(iso) → { code: string, label: string }` — mirrors app `financialYear`.
  - `seqFromCode(code) → number` — leading digits (mirrors `parsePurchaseSeq`).
  - `fyCodeFromCode(code) → string` — the `/NNNN` FY token, or `''`.
  - `round2(n) → number` — sign-symmetric rounding.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/purchase-import.test.mjs`:

```javascript
import { describe, it, expect } from 'vitest'
import { cleanNumber, parseDateMDY, fyFromDate, seqFromCode, fyCodeFromCode, round2 } from '../../scripts/purchase-import.mjs'

describe('cleanNumber', () => {
  it('strips thousands commas', () => { expect(cleanNumber('51,000.00')).toBe(51000) })
  it('treats blank as zero', () => { expect(cleanNumber('')).toBe(0) })
  it('keeps negatives', () => { expect(cleanNumber('-1.2')).toBe(-1.2) })
  it('returns NaN for non-numeric', () => { expect(Number.isNaN(cleanNumber('abc'))).toBe(true) })
})

describe('parseDateMDY', () => {
  it('parses M/D/YYYY', () => { expect(parseDateMDY('1/12/2026')).toBe('2026-01-12') })
  it('pads single digits', () => { expect(parseDateMDY('4/1/2025')).toBe('2025-04-01') })
  it('rejects an impossible date', () => { expect(parseDateMDY('2/30/2025')).toBe(null) })
  it('rejects garbage', () => { expect(parseDateMDY('not a date')).toBe(null) })
})

describe('fyFromDate', () => {
  it('April starts a new FY', () => { expect(fyFromDate('2025-04-01')).toEqual({ code: '2526', label: '2025-26' }) })
  it('March is the prior FY', () => { expect(fyFromDate('2026-03-31')).toEqual({ code: '2526', label: '2025-26' }) })
  it('next FY', () => { expect(fyFromDate('2026-04-01')).toEqual({ code: '2627', label: '2026-27' }) })
})

describe('seqFromCode / fyCodeFromCode', () => {
  it('reads the leading sequence', () => { expect(seqFromCode('082/2526')).toBe(82) })
  it('reads the FY token', () => { expect(fyCodeFromCode('082/2526')).toBe('2526') })
  it('missing token → empty', () => { expect(fyCodeFromCode('82')).toBe('') })
})

describe('round2', () => {
  it('rounds symmetrically', () => { expect(round2(-1.005)).toBe(-1.01); expect(round2(1.005)).toBe(1.01) })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/purchase-import.test.mjs`
Expected: FAIL — module `scripts/purchase-import.mjs` not found.

- [ ] **Step 3: Implement the primitives**

Create `scripts/purchase-import.mjs`:

```javascript
// Pure helpers for the one-time purchase CSV import (see import-purchases.mjs).
// Plain ESM so both the CLI and vitest import the same code. No DB access here.

// Sign-symmetric 2-decimal rounding — mirrors src/shared/money.ts round2.
export function round2(n) {
  return Math.sign(n) * Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
}

// "51,000.00" -> 51000 ; "" -> 0 ; "-1.2" -> -1.2 ; "abc" -> NaN
export function cleanNumber(s) {
  const t = String(s ?? '').replace(/[,₹\s]/g, '').trim()
  if (t === '') return 0
  const n = Number(t)
  return Number.isFinite(n) ? n : NaN
}

// "M/D/YYYY" -> "YYYY-MM-DD" (or null if unparseable / not a real calendar date)
export function parseDateMDY(s) {
  const m = String(s ?? '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (!m) return null
  const month = Number(m[1]), day = Number(m[2]), year = Number(m[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  const d = new Date(iso + 'T00:00:00Z')
  if (Number.isNaN(d.getTime()) || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) return null
  return iso
}

// Mirrors src/main/core/financial-year.ts financialYear() (code + label only).
export function fyFromDate(iso) {
  const [y, mm] = iso.split('-')
  const year = Number(y), month = Number(mm)
  const startYear = month >= 4 ? year : year - 1
  const endYear = startYear + 1
  return { code: `${String(startYear).slice(2)}${String(endYear).slice(2)}`, label: `${startYear}-${String(endYear).slice(2)}` }
}

// Mirrors src/main/core/purchase.ts parsePurchaseSeq().
export function seqFromCode(code) {
  const m = String(code ?? '').trim().match(/^(\d+)/)
  return m ? Number(m[1]) : 0
}

// The "/NNNN" financial-year token embedded in a code like "082/2526", or '' if absent.
export function fyCodeFromCode(code) {
  const m = String(code ?? '').trim().match(/\/(\d{4})(?:\D|$)/)
  return m ? m[1] : ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/purchase-import.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/purchase-import.mjs tests/scripts/purchase-import.test.mjs
git commit -m "feat(import): purchase CSV parsing primitives"
```

---

### Task 5: `mapPurchaseRows` and report builders

**Files:**
- Modify: `scripts/purchase-import.mjs` (add `mapPurchaseRows`, `buildLogReport`, `buildSkippedCsv`)
- Modify: `tests/scripts/purchase-import.test.mjs` (add cases)

**Interfaces:**
- Consumes: the Task 4 primitives.
- Produces:
  - `mapPurchaseRows(rows) → { header, toImport, skipped, warnings }` where `rows` is `parseCsv` output (incl. header).
    - `toImport[]` entries: `{ line, our_code, supplier_invoice_number, invoice_date, party, description, hsn_code, gst_rate, qty_kg, rate_per_kg, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount, fy_label, code_seq }`.
    - `skipped[]` entries: `{ line, code, party, reason, raw }` (`raw` = original cell array).
    - `warnings[]` entries: `{ line, code, reason }`.
    - `header` = the detected header row's original cells.
  - `buildSkippedCsv(header, skipped) → string`.
  - `buildLogReport({ mode, csvPath, counts, skipped, warnings, suppliersToCreate }) → string`.

- [ ] **Step 1: Write the failing test**

Add to `tests/scripts/purchase-import.test.mjs`:

```javascript
import { parseCsv } from '../../scripts/customer-import.mjs'
import { mapPurchaseRows, buildSkippedCsv, buildLogReport } from '../../scripts/purchase-import.mjs'

const HEADER = 'Our Code,Invoice Number,Invoice Date,Party,Description,HSN Code,Qty,Amount,CGST,SGST,IGST,TCS,Total,R/Off,Total Invoice Amount'
const GOOD = '082/2526,SPL/25-26/3079,1/12/2026,SWASTIK,Black M/B,320419,300,"51,000.00","4,590.00","4,590.00",,,"9,180.00",,"60,180.00"'

describe('mapPurchaseRows', () => {
  it('maps a valid row and trusts the sheet tax values', () => {
    const { toImport, skipped, warnings } = mapPurchaseRows(parseCsv(`${HEADER}\n${GOOD}\n`))
    expect(skipped).toEqual([])
    expect(warnings).toEqual([])
    expect(toImport).toHaveLength(1)
    expect(toImport[0]).toMatchObject({
      our_code: '082/2526', invoice_date: '2026-01-12', party: 'SWASTIK', description: 'Black M/B',
      hsn_code: '320419', qty_kg: 300, amount: 51000, cgst: 4590, sgst: 4590, igst: 0, tcs: 0,
      roundoff: 0, total_invoice_amount: 60180, rate_per_kg: 170, gst_rate: 18,
      fy_label: '2025-26', code_seq: 82,
    })
  })

  it('skips an unparseable date and a non-positive qty, keeping the raw row', () => {
    const bad = '083/2526,X,not-a-date,ACME,Nat,3902,0,100,,,,,,,100'
    const { toImport, skipped } = mapPurchaseRows(parseCsv(`${HEADER}\n${bad}\n`))
    expect(toImport).toEqual([])
    expect(skipped).toHaveLength(1)
    expect(skipped[0].reason).toMatch(/date/)
    expect(skipped[0].reason).toMatch(/Qty/)
    expect(skipped[0].raw[0]).toBe('083/2526')
  })

  it('skips a row whose code year disagrees with its date year', () => {
    // code says 2526 (FY 2025-26) but date is in FY 2026-27
    const mism = '090/2526,X,4/1/2026,ACME,Nat,3902,10,100,,,,,,,100'
    const { skipped } = mapPurchaseRows(parseCsv(`${HEADER}\n${mism}\n`))
    expect(skipped[0].reason).toMatch(/code year 2526 . date year 2627/)
  })

  it('warns (but still imports) when the tax cross-check is off by more than a rupee', () => {
    const off = '091/2526,X,1/5/2026,ACME,Nat,3902,10,1000,90,90,,,,,2000'
    const { toImport, warnings } = mapPurchaseRows(parseCsv(`${HEADER}\n${off}\n`))
    expect(toImport).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0].reason).toMatch(/cross-check/)
  })
})

describe('buildSkippedCsv', () => {
  it('reproduces original columns plus a Skip Reason column', () => {
    const header = ['Our Code', 'Party']
    const skipped = [{ line: 3, code: '9', party: 'A, B', reason: 'bad date', raw: ['9', 'A, B'] }]
    expect(buildSkippedCsv(header, skipped)).toBe('Our Code,Party,Skip Reason\n9,"A, B",bad date')
  })
})

describe('buildLogReport', () => {
  it('includes the mode, counts, and each skip reason', () => {
    const text = buildLogReport({
      mode: 'dry-run', csvPath: 'p.csv',
      counts: { read: 2, toInsert: 1, duplicate: 0, skipped: 1 },
      skipped: [{ line: 3, code: '9', party: 'A', reason: 'bad date' }],
      warnings: [], suppliersToCreate: ['A'],
    })
    expect(text).toMatch(/dry-run/)
    expect(text).toMatch(/line 3 · 9 · A · bad date/)
    expect(text).toMatch(/Suppliers to create: A/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/scripts/purchase-import.test.mjs`
Expected: FAIL — `mapPurchaseRows` / builders not exported.

- [ ] **Step 3: Implement the mapper and builders**

Append to `scripts/purchase-import.mjs`:

```javascript
const norm = (h) => h.trim().toLowerCase().replace(/\.$/, '')

const HEADER_MAP = {
  'our code': 'code',
  'invoice number': 'supplier_invoice_number',
  'invoice date': 'invoice_date',
  'party': 'party',
  'description': 'description',
  'hsn code': 'hsn_code', 'hsn': 'hsn_code',
  'qty': 'qty',
  'amount': 'amount',
  'cgst': 'cgst', 'sgst': 'sgst', 'igst': 'igst', 'tcs': 'tcs',
  'total': 'total',
  'r/off': 'roundoff', 'round off': 'roundoff', 'roundoff': 'roundoff',
  'total invoice amount': 'total_invoice_amount',
}

// rows (incl. header) -> { header, toImport, skipped, warnings }
export function mapPurchaseRows(rows) {
  const toImport = [], skipped = [], warnings = []
  if (rows.length === 0) return { header: [], toImport, skipped, warnings }

  let headerIdx = rows.findIndex(r => r.map(norm).some(h => HEADER_MAP[h] !== undefined))
  if (headerIdx === -1) headerIdx = 0
  const header = rows[headerIdx]
  const col = {}
  header.map(norm).forEach((h, i) => { const f = HEADER_MAP[h]; if (f && col[f] === undefined) col[f] = i })
  const get = (r, key) => col[key] !== undefined ? (r[col[key]] ?? '').trim() : ''

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const r = rows[i]
    const line = i + 1
    const code = get(r, 'code'), party = get(r, 'party'), hsn = get(r, 'hsn_code')
    const reasons = []

    const iso = parseDateMDY(get(r, 'invoice_date'))
    if (!iso) reasons.push(`unparseable date "${get(r, 'invoice_date')}"`)
    const qty = cleanNumber(get(r, 'qty'))
    if (!(qty > 0)) reasons.push('Qty must be > 0')
    if (!code) reasons.push('missing Our Code')
    if (!party) reasons.push('missing Party')
    if (!hsn) reasons.push('missing HSN Code')
    if (iso) {
      const codeFy = fyCodeFromCode(code)
      const dateFy = fyFromDate(iso).code
      if (codeFy && codeFy !== dateFy) reasons.push(`code year ${codeFy} ≠ date year ${dateFy}`)
    }

    if (reasons.length) { skipped.push({ line, code, party, reason: reasons.join('; '), raw: r }); continue }

    const amount = cleanNumber(get(r, 'amount'))
    const cgst = cleanNumber(get(r, 'cgst')), sgst = cleanNumber(get(r, 'sgst'))
    const igst = cleanNumber(get(r, 'igst')), tcs = cleanNumber(get(r, 'tcs'))
    const roundoff = cleanNumber(get(r, 'roundoff'))
    const total_invoice_amount = cleanNumber(get(r, 'total_invoice_amount'))

    const expected = round2(amount + cgst + sgst + igst + tcs + roundoff)
    if (Math.abs(expected - total_invoice_amount) > 1)
      warnings.push({ line, code, reason: `tax cross-check off: computed ${expected} vs sheet ${total_invoice_amount}` })

    const gst_rate = amount > 0 ? Math.round(((cgst + sgst + igst) / amount) * 100) : 18
    toImport.push({
      line, our_code: code, supplier_invoice_number: get(r, 'supplier_invoice_number'),
      invoice_date: iso, party, description: get(r, 'description'), hsn_code: hsn, gst_rate,
      qty_kg: round2(qty), rate_per_kg: round2(amount / qty), amount: round2(amount),
      cgst: round2(cgst), sgst: round2(sgst), igst: round2(igst), tcs: round2(tcs),
      roundoff: round2(roundoff), total_invoice_amount: round2(total_invoice_amount),
      fy_label: fyFromDate(iso).label, code_seq: seqFromCode(code),
    })
  }
  return { header, toImport, skipped, warnings }
}

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

export function buildSkippedCsv(header, skipped) {
  const head = [...header, 'Skip Reason'].map(csvEscape).join(',')
  if (!skipped.length) return head
  const body = skipped.map(s => [...(s.raw ?? []), s.reason].map(csvEscape).join(',')).join('\n')
  return head + '\n' + body
}

export function buildLogReport({ mode, csvPath, counts, skipped, warnings, suppliersToCreate }) {
  const lines = []
  lines.push(`Purchase import report — mode: ${mode}`)
  lines.push(`Source: ${csvPath}`)
  lines.push('')
  lines.push(`Rows read:        ${counts.read}`)
  lines.push(`Will insert:      ${counts.toInsert}`)
  lines.push(`Skip (duplicate): ${counts.duplicate}`)
  lines.push(`Skip (invalid):   ${counts.skipped}`)
  lines.push('')
  lines.push(`Suppliers to create: ${suppliersToCreate.length ? suppliersToCreate.join(', ') : '(none)'}`)
  lines.push('')
  lines.push('Skipped rows:')
  for (const s of skipped) lines.push(`  line ${s.line} · ${s.code || '(no code)'} · ${s.party || '(no party)'} · ${s.reason}`)
  if (!skipped.length) lines.push('  (none)')
  lines.push('')
  lines.push('Warnings (imported anyway):')
  for (const w of warnings) lines.push(`  line ${w.line} · ${w.code} · ${w.reason}`)
  if (!warnings.length) lines.push('  (none)')
  return lines.join('\n')
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/purchase-import.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/purchase-import.mjs tests/scripts/purchase-import.test.mjs
git commit -m "feat(import): map purchase rows and build log/skipped reports"
```

---

### Task 6: DB layer `scripts/purchase-db.mjs`

**Files:**
- Create: `scripts/purchase-db.mjs`
- Test: `tests/scripts/purchase-db.test.ts` (create — TypeScript, to reuse `openDatabase` for a fully-migrated in-memory DB)

**Interfaces:**
- Consumes: a `better-sqlite3` `Database` handle (passed in; this module never imports the driver).
- Produces:
  - `ensureDescriptionColumn(db)` — adds `purchases.description` if missing (for legacy DBs).
  - `planImport(db, toImport) → { toInsert, duplicates, suppliersToCreate }` — read-only classification. `duplicates` are `toImport` entries whose `(fy_label, code_seq)` already exists; `suppliersToCreate` are distinct party names not already in `suppliers` (case-insensitive).
  - `commitImport(db, toInsert) → { inserted, suppliersCreated }` — inside one transaction: ensures each HSN, upserts suppliers by name, inserts purchases with `supplier_id`, `payment_status='done'`, `payment_date=null`, `qty_remaining_kg=qty_kg`.

- [ ] **Step 1: Write the failing test**

Create `tests/scripts/purchase-db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
// @ts-expect-error — plain ESM module, no types
import { planImport, commitImport, ensureDescriptionColumn } from '../../scripts/purchase-db.mjs'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const row = (over: Partial<any> = {}) => ({
  our_code: '082/2526', supplier_invoice_number: 'SPL/1', invoice_date: '2026-01-12', party: 'SWASTIK',
  description: 'Black M/B', hsn_code: '320419', gst_rate: 18, qty_kg: 300, rate_per_kg: 170, amount: 51000,
  cgst: 4590, sgst: 4590, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 60180,
  fy_label: '2025-26', code_seq: 82, ...over,
})

describe('planImport', () => {
  it('flags an existing (fy_label, code_seq) as a duplicate and lists new suppliers', () => {
    commitImport(db, [row()])
    const plan = planImport(db, [row({ description: 'again' }), row({ our_code: '083/2526', code_seq: 83, party: 'NEWCO' })])
    expect(plan.duplicates.map((d: any) => d.code_seq)).toEqual([82])
    expect(plan.toInsert.map((d: any) => d.code_seq)).toEqual([83])
    expect(plan.suppliersToCreate).toEqual(['NEWCO'])
  })
})

describe('commitImport', () => {
  it('inserts a purchase, links a supplier by name, ensures the HSN, and keeps the sheet values', () => {
    const { inserted, suppliersCreated } = commitImport(db, [row()])
    expect(inserted).toBe(1)
    expect(suppliersCreated).toBe(1)
    const p: any = db.prepare('SELECT * FROM purchases WHERE code_seq = 82 AND fy_label = ?').get('2025-26')
    expect(p.description).toBe('Black M/B')
    expect(p.total_invoice_amount).toBe(60180)
    expect(p.qty_remaining_kg).toBe(300)
    expect(p.payment_status).toBe('done')
    expect(p.supplier_id).toBeGreaterThan(0)
    const s: any = db.prepare('SELECT name FROM suppliers WHERE id = ?').get(p.supplier_id)
    expect(s.name).toBe('SWASTIK')
    expect(db.prepare('SELECT COUNT(*) c FROM hsn_products WHERE hsn_code = ?').get('320419')).toMatchObject({ c: 1 })
  })

  it('re-running with the same lot inserts nothing new (dedup by fy_label+code_seq)', () => {
    commitImport(db, [row()])
    const plan = planImport(db, [row()])
    expect(plan.toInsert).toHaveLength(0)
    expect(plan.duplicates).toHaveLength(1)
  })

  it('ensureDescriptionColumn adds the column to a DB that lacks it', () => {
    db.exec('ALTER TABLE purchases DROP COLUMN description')
    ensureDescriptionColumn(db)
    const cols = db.prepare('PRAGMA table_info(purchases)').all() as Array<{ name: string }>
    expect(cols.some(c => c.name === 'description')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run rebuild:node && npx vitest run tests/scripts/purchase-db.test.ts`
Expected: FAIL — module `scripts/purchase-db.mjs` not found.

- [ ] **Step 3: Implement the DB layer**

Create `scripts/purchase-db.mjs`:

```javascript
// DB operations for the purchase import. Receives a better-sqlite3 handle;
// never imports the driver, so it is unit-testable against an in-memory DB.

export function ensureDescriptionColumn(db) {
  const cols = db.prepare('PRAGMA table_info(purchases)').all()
  if (!cols.some(c => c.name === 'description'))
    db.exec(`ALTER TABLE purchases ADD COLUMN description TEXT NOT NULL DEFAULT ''`)
}

// Read-only classification: which rows are new, which are duplicates, which suppliers are new.
export function planImport(db, toImport) {
  const dupStmt = db.prepare('SELECT id FROM purchases WHERE fy_label = ? AND code_seq = ?')
  const supStmt = db.prepare('SELECT id FROM suppliers WHERE lower(trim(name)) = lower(trim(?))')
  const toInsert = [], duplicates = [], newSuppliers = new Set(), seenKeys = new Set()
  for (const r of toImport) {
    const key = `${r.fy_label}#${r.code_seq}`
    if (dupStmt.get(r.fy_label, r.code_seq) || seenKeys.has(key)) { duplicates.push(r); continue }
    seenKeys.add(key)
    toInsert.push(r)
    if (!supStmt.get(r.party) && !newSuppliers.has(r.party.trim().toLowerCase()))
      newSuppliers.add(r.party.trim().toLowerCase())
  }
  // Preserve first-seen original-case names for the report.
  const names = []
  const seenName = new Set()
  for (const r of toInsert) {
    const k = r.party.trim().toLowerCase()
    if (newSuppliers.has(k) && !seenName.has(k) && !supStmt.get(r.party)) { seenName.add(k); names.push(r.party.trim()) }
  }
  return { toInsert, duplicates, suppliersToCreate: names }
}

// Writes everything in one transaction. Returns counts.
export function commitImport(db, toInsert) {
  ensureDescriptionColumn(db)
  const findSup = db.prepare('SELECT id FROM suppliers WHERE lower(trim(name)) = lower(trim(?))')
  const insSup = db.prepare('INSERT INTO suppliers (name) VALUES (?)')
  const ensureHsn = db.prepare(`INSERT OR IGNORE INTO hsn_products (hsn_code, description, gst_rate) VALUES (?, '', ?)`)
  const insPurchase = db.prepare(`INSERT INTO purchases
    (our_code, supplier_invoice_number, invoice_date, party, party_state, hsn_code, description,
     party_city, party_pincode, party_address, qty_kg, qty_remaining_kg, rate_per_kg, amount,
     cgst, sgst, igst, tcs, roundoff, total_invoice_amount, payment_status, payment_date,
     fy_label, code_seq, supplier_id)
    VALUES (@our_code, @supplier_invoice_number, @invoice_date, @party, '', @hsn_code, @description,
     '', '', '', @qty_kg, @qty_kg, @rate_per_kg, @amount,
     @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount, 'done', NULL,
     @fy_label, @code_seq, @supplier_id)`)

  let inserted = 0, suppliersCreated = 0
  const run = db.transaction((rows) => {
    for (const r of rows) {
      let sup = findSup.get(r.party)
      if (!sup) { const info = insSup.run(r.party.trim()); sup = { id: Number(info.lastInsertRowid) }; suppliersCreated++ }
      ensureHsn.run(r.hsn_code, r.gst_rate)
      // Bind only the columns the statement declares (r also carries `line` and `gst_rate`,
      // which are not bind parameters).
      insPurchase.run({
        our_code: r.our_code, supplier_invoice_number: r.supplier_invoice_number, invoice_date: r.invoice_date,
        party: r.party, hsn_code: r.hsn_code, description: r.description, qty_kg: r.qty_kg,
        rate_per_kg: r.rate_per_kg, amount: r.amount, cgst: r.cgst, sgst: r.sgst, igst: r.igst, tcs: r.tcs,
        roundoff: r.roundoff, total_invoice_amount: r.total_invoice_amount, fy_label: r.fy_label,
        code_seq: r.code_seq, supplier_id: sup.id,
      })
      inserted++
    }
  })
  run(toInsert)
  return { inserted, suppliersCreated }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/scripts/purchase-db.test.ts`
Expected: PASS.

Note: if `ALTER TABLE ... DROP COLUMN` is unsupported by the bundled SQLite, replace that one test's setup with a raw legacy table (as in Task 1's migration test) instead of dropping the column.

- [ ] **Step 5: Commit**

```bash
git add scripts/purchase-db.mjs tests/scripts/purchase-db.test.ts
git commit -m "feat(import): purchase DB plan/commit layer with dedup and supplier linking"
```

---

### Task 7: CLI `scripts/import-purchases.mjs` + README

**Files:**
- Create: `scripts/import-purchases.mjs`
- Modify: `scripts/README.md`

**Interfaces:**
- Consumes: `parseCsv` (from `customer-import.mjs`), `mapPurchaseRows`/`buildLogReport`/`buildSkippedCsv` (Task 5), `ensureDescriptionColumn`/`planImport`/`commitImport` (Task 6).

- [ ] **Step 1: Implement the CLI**

Create `scripts/import-purchases.mjs`:

```javascript
// One-time purchase import from a CSV export into a granule-trader database.
//
// Usage:
//   1. Quit the Granule Trader app (so the database file is not locked).
//   2. Build the native module for Node once:  npm run rebuild:node
//   3. Dry-run (writes NOTHING to the DB):
//        node scripts/import-purchases.mjs <path/to/granule-trader.db> <purchases.csv>
//   4. Review the *.log and *-skipped.csv files written next to the CSV, then:
//        node scripts/import-purchases.mjs <path/to/granule-trader.db> <purchases.csv> --commit
//
// Idempotent: re-running skips lots whose (financial year, code sequence) already exist.
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, basename, join } from 'node:path'
import { createRequire } from 'node:module'
import { parseCsv } from './customer-import.mjs'
import { mapPurchaseRows, buildLogReport, buildSkippedCsv } from './purchase-import.mjs'
import { ensureDescriptionColumn, planImport, commitImport } from './purchase-db.mjs'

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const args = process.argv.slice(2)
const commit = args.includes('--commit')
const [dbPath, csvPath] = args.filter(a => a !== '--commit')
if (!dbPath || !csvPath) {
  console.error('Usage: node scripts/import-purchases.mjs <granule-trader.db> <purchases.csv> [--commit]')
  process.exit(2)
}

const { header, toImport, skipped, warnings } = mapPurchaseRows(parseCsv(readFileSync(csvPath, 'utf8')))

const db = new Database(dbPath)
ensureDescriptionColumn(db)
const { toInsert, duplicates, suppliersToCreate } = planImport(db, toImport)

const counts = { read: toImport.length + skipped.length, toInsert: toInsert.length, duplicate: duplicates.length, skipped: skipped.length }
const mode = commit ? 'commit' : 'dry-run'
const log = buildLogReport({ mode, csvPath, counts, skipped, warnings, suppliersToCreate })
const skippedCsv = buildSkippedCsv(header, skipped)

const stamp = new Date().toISOString().replace(/[:.]/g, '-')
const base = basename(csvPath).replace(/\.[^.]+$/, '')
const dir = dirname(csvPath)
const logPath = join(dir, `${base}-import-${stamp}.log`)
const skPath = join(dir, `${base}-import-skipped-${stamp}.csv`)
writeFileSync(logPath, log)
writeFileSync(skPath, skippedCsv)

console.log(log)
console.log(`\nReport:        ${logPath}`)
console.log(`Skipped rows:  ${skPath}`)

if (!commit) {
  console.log('\nDry-run — nothing written to the database. Re-run with --commit to import.')
  db.close()
  process.exit(0)
}

try {
  const { inserted, suppliersCreated } = commitImport(db, toInsert)
  console.log(`\n✓ Imported ${inserted} purchase(s), created ${suppliersCreated} supplier(s). Skipped ${duplicates.length} duplicate(s), ${skipped.length} invalid.`)
} catch (e) {
  console.error('Import failed (rolled back):', e.message)
  db.close()
  process.exit(1)
}
db.close()
```

- [ ] **Step 2: Smoke-test the CLI end to end (dry-run then commit) on a copy of a real DB**

A fresh empty `.db` has no tables, so the smoke test runs against a **copy of an already-schema'd database** (any DB the app has opened — e.g. the App Support one). Nothing here touches live data.

```bash
npm run rebuild:node
TMP=$(mktemp -d)
cp "$HOME/Library/Application Support/granule-trader/granule-trader.db" "$TMP/test.db"
printf 'Our Code,Invoice Number,Invoice Date,Party,Description,HSN Code,Qty,Amount,CGST,SGST,IGST,TCS,Total,R/Off,Total Invoice Amount\nZZ9/2526,SPL/SMOKE,1/12/2026,SMOKE TEST CO,Black M/B,320419,300,"51,000.00","4,590.00","4,590.00",,,"9,180.00",,"60,180.00"\n' > "$TMP/p.csv"

node scripts/import-purchases.mjs "$TMP/test.db" "$TMP/p.csv"          # dry-run
ls "$TMP"/*.log "$TMP"/*-skipped.csv                                    # report files exist
node scripts/import-purchases.mjs "$TMP/test.db" "$TMP/p.csv" --commit  # commit: inserts 1
node scripts/import-purchases.mjs "$TMP/test.db" "$TMP/p.csv" --commit  # re-run: 1 duplicate, 0 inserted
rm -rf "$TMP"
```

Expected: dry-run writes the two report files and nothing to the DB; first `--commit` inserts 1 purchase + 1 supplier (`SMOKE TEST CO`); second `--commit` reports 1 duplicate and inserts nothing. (The `ZZ9/2526` code is a made-up sequence unlikely to collide.)

(The DB-layer behaviour is already covered by Task 6's automated tests; this step is a manual wiring check.)

- [ ] **Step 3: Document the importer in the README**

Append to `scripts/README.md`:

```markdown
## Purchase import

Imports historical purchases from a CSV export (one row per invoice) into a
Granule Trader `.db`. Dry-run by default — review the report files, then commit.

1. Quit Granule Trader (release the data lock).
2. `npm run rebuild:node`
3. Export the purchase tab to CSV. Dates must be `M/D/YYYY`; amounts may have commas.
4. Dry-run: `node scripts/import-purchases.mjs <granule-trader.db> <purchases.csv>`
   - Writes `<name>-import-<stamp>.log` and `<name>-import-skipped-<stamp>.csv` next to the CSV.
   - Skips rows with a bad date, non-positive qty, blank code/party/HSN, or a
     code-year that disagrees with the date-year — fix those in the skipped CSV and re-export.
5. Commit: add `--commit`. Idempotent — re-running skips lots already imported
   (matched by financial year + code sequence).

Tax figures (CGST/SGST/IGST/TCS/round-off/total) are imported verbatim from the
sheet. Suppliers are created by name only; fill in their details later in Suppliers.
```

- [ ] **Step 4: Commit**

```bash
git add scripts/import-purchases.mjs scripts/README.md
git commit -m "feat(import): purchase CSV import CLI with dry-run and report files"
```

---

## Self-Review notes

- **Spec coverage:** description schema (T1) + persistence (T2) + UI (T3); trust-the-sheet mapping and derived rate/gst_rate (T5); supplier-by-name + dedup by `(fy_label, code_seq)` (T6); dry-run + `--commit` + `.log`/`-skipped.csv` report files with raw columns (T5 builders, T7 CLI); `M/D/YYYY` and FY-from-date with code/date mismatch as a hard skip (T5); tax cross-check as warning-only (T5). All spec sections map to a task.
- **`round2`, `fyFromDate`, `seqFromCode`** are duplicated from `src/` into the `.mjs` helper by necessity (ESM script cannot import the TS core without a build); each carries a "mirrors …" comment and is unit-tested against the same expected values the app produces.
- **DB test is `.ts`** (not `.mjs`) so it can call `openDatabase` for a fully-migrated in-memory DB; it imports the `.mjs` DB module.
```
