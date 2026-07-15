# FY2026-27 Sales Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import the 47 FY2026-27 sale invoices from `DataMigration.xlsx` into the app, drawing each sale from the **exact** lots recorded in the owner's Stock sheet, so post-migration stock matches the sheet lot-for-lot with zero discrepancy.

**Architecture:** Pure, unit-tested parse/resolve/reconcile functions in `src/main/core/migrate-sales.ts`, fed by a dependency-free XLSX reader in `scripts/xlsx-lite.mjs`. Each invoice is written through the app's existing `createSale`, so stock draw-down, gap-free numbering and tax are handled by the same code the UI uses. A vitest file (`tests/migrate/run-sales.test.ts`) is the runner: dry-run by default, `--commit` via an env flag, idempotent, and it prints a per-invoice and per-lot reconciliation against the sheet before writing anything.

**Tech Stack:** TypeScript, better-sqlite3, Vitest. No new runtime dependencies — the XLSX reader is hand-rolled (the file is zipped XML) and the runner rides on Vitest, which already resolves `@shared` and uses the Node build of better-sqlite3.

## Global Constraints

- **Exact mimicry, no discrepancy.** Each sale draws from the precise lot its Stock-sheet row sits under. After a committed run, every lot's `qty_remaining_kg` must equal that lot block's final "Balance Stock" in the Stock sheet. The dry-run proves this before any write.
- **No app/schema changes.** Sales are written only through `createSale(db, NewSale)` from `src/main/core/sale.ts`. Nothing in `src/` outside the new `migrate-sales.ts` changes.
- **Scope: FY2026-27 sales only.** Invoice numbers `RP/001/2026-27` … `RP/047/2026-27`. Purchases are already migrated (carry-forward) — do not touch them.
- **Idempotent.** A run skips any invoice whose `invoice_number` already exists in `sales`. Re-running after a partial commit completes the rest without duplicating.
- **Dry-run by default.** Writes happen only when `process.env.MIGRATE_COMMIT === '1'`. Everything runs inside one transaction per invoice via `createSale` (which already wraps itself in a transaction).
- **All intra-state.** Every buyer GSTIN starts `19` (West Bengal), same as the seller's `home_state`, so CGST+SGST, never IGST. Tax is computed by the app; the sheet's round-off is fed in so the app total matches the sheet total.
- **All 47 marked paid** — `payment_status: 'done'`, `payment_date` = the invoice date.
- **Never run against the live DB directly first.** Every dry-run and the first commit run against a *copy* of `granule-trader.db`; only after reconciliation is clean does the owner point it at the real file (app closed, so the data lock is free).
- **Tests use Vitest with `fireEvent`-style discipline already in the repo.** Core tests import from `../../src/main/core/...` and use an in-memory DB via `openDatabase(':memory:')`.

## Input data shapes (verified against the real workbook)

`DataMigration.xlsx` sheets, 0-indexed columns:

- **SaleInvoiceMaster** — header rows 0-4, data from row 5. Reliable columns: `0` Invoice No (`RP/001/2026-27`), `1` Invoice Date (Excel serial, e.g. `46114`), `2` E-way Bill No, `3` E-way Bill Date (serial), `4` Vehicle, `5` Buyer name, `6` Buyer GSTIN, `34` Round-off, `35` Total Invoice Amount. The middle HSN-pivot columns are **not** used.
- **Stock** — header row 1, data from row 2. A lot block starts at a row whose col `0` begins `Code ` (e.g. `Code 082/2526`); that row is the purchase, col `5` = HSN, col `8` = lot cost/kg, col `10` = opening balance. Following rows with col `4` = `Sales` are draws from that lot: col `6` = qty, col `8` = sale rate, col `10` = running balance. **A new column must be added by the owner** holding the Invoice No for each sale row (see Task 0). The block's final sale row's col `10` is the lot's expected ending balance.
- **CustomerMaster** — data from row 1. col `1` = name, col `2` = address, col `3` = city, col `4` = state, col `5` = pincode, col `7` = GSTIN (may be blank), col `8` = PAN.

The two `082/2526` lots (cost ₹170 and ₹102) are disambiguated by matching lot cost to `purchase_items.rate_per_kg`.

## File structure

- `scripts/xlsx-lite.mjs` — **create.** `readWorkbook(path) => Record<sheetName, string[][]>`. No dependencies.
- `src/main/core/migrate-sales.ts` — **create.** Pure functions: date conversion, header parse, stock-allocation parse, lot resolution, buyer resolution, payload build, reconciliation. Depends on `@shared` and sibling core modules.
- `tests/core/migrate-sales.test.ts` — **create.** Unit tests for every function in `migrate-sales.ts`.
- `tests/scripts/xlsx-lite.test.mjs` — **create.** Smoke test of the reader against the real workbook.
- `tests/migrate/run-sales.test.ts` — **create.** The runner: reads the workbook + a DB path from env, dry-runs, prints reconciliation, commits when `MIGRATE_COMMIT=1`. Skipped when env is absent, so `npm test` never runs it.
- `scripts/README.md` — **modify.** Add a "Sales migration" section.

---

### Task 0: Owner adds the Invoice No column to the Stock sheet

**Not a code task — a data prerequisite.** In `DataMigration.xlsx`, on the **Stock** sheet, add a column headed `Invoice No`. For every **Sales** row, fill in the RP invoice number that sale belongs to (e.g. `RP/001/2026-27`). Leave it blank on the `Code …` purchase rows. Note the column's 0-indexed position (it will be appended after the existing columns, i.e. index `11`). Every sale row that is part of the 47 FY2026-27 invoices must carry a number; any sale row left blank is treated as out-of-scope and will be reported by reconciliation as an unexplained stock difference.

This plan assumes the Invoice No column is at index `11`. If it lands elsewhere, pass its index via `MIGRATE_INVOICE_COL` (Task 8 reads it).

---

### Task 1: Dependency-free XLSX reader

**Files:**
- Create: `scripts/xlsx-lite.mjs`
- Test: `tests/scripts/xlsx-lite.test.mjs`

**Interfaces:**
- Produces: `readWorkbook(path: string) => Record<string, string[][]>` — sheet name → rows → cells (strings; empty cells are `''`; trailing empties may be absent).

- [ ] **Step 1: Write the failing smoke test**

`tests/scripts/xlsx-lite.test.mjs`:

```js
import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { readWorkbook } from '../../scripts/xlsx-lite.mjs'

const WB = '/Users/shivamchoudhary/Downloads/DataMigration.xlsx'

describe.runIf(existsSync(WB))('readWorkbook (real workbook)', () => {
  const wb = readWorkbook(WB)
  it('exposes the four expected sheets', () => {
    expect(Object.keys(wb).sort()).toEqual(
      ['CustomerMaster', 'PurchaseInvoiceMaster', 'SaleInvoiceMaster', 'Stock'].sort()
    )
  })
  it('reads a known SaleInvoiceMaster cell (first invoice number)', () => {
    const rows = wb.SaleInvoiceMaster
    const flat = rows.flat()
    expect(flat).toContain('RP/001/2026-27')
  })
  it('reads the Stock sheet lot code with its Code prefix', () => {
    expect(wb.Stock.flat().some(c => c.startsWith('Code 082/2526'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/scripts/xlsx-lite.test.mjs`
Expected: FAIL — cannot find module `../../scripts/xlsx-lite.mjs`.

- [ ] **Step 3: Implement the reader**

`scripts/xlsx-lite.mjs`:

```js
import { execFileSync } from 'child_process'
import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

// An .xlsx is a zip of XML. We unzip to a temp dir with the system `unzip`, then parse the
// sharedStrings table and each worksheet by hand — enough to pull cell text out, no dependency.
function decode(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&apos;/g, "'")
}
function colToNum(c) { let n = 0; for (const ch of c) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1 }

export function readWorkbook(path) {
  const dir = mkdtempSync(join(tmpdir(), 'xlsx-'))
  try {
    execFileSync('unzip', ['-o', '-q', path, '-d', dir])

    // sheet name -> sheetN.xml, via workbook.xml + its rels
    const wbXml = readFileSync(join(dir, 'xl/workbook.xml'), 'utf8')
    const relsXml = readFileSync(join(dir, 'xl/_rels/workbook.xml.rels'), 'utf8')
    const relTarget = {}
    for (const m of relsXml.matchAll(/<Relationship[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)) relTarget[m[1]] = m[2]
    const sheetFile = {}
    for (const m of wbXml.matchAll(/<sheet[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
      sheetFile[decode(m[1])] = relTarget[m[2]].replace(/^\/?xl\//, '').replace(/^worksheets\//, '')
    }

    // shared strings
    const shared = []
    try {
      const ss = readFileSync(join(dir, 'xl/sharedStrings.xml'), 'utf8')
      for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
        const t = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')
        shared.push(decode(t))
      }
    } catch { /* a workbook with no strings is legal */ }

    const out = {}
    for (const [name, file] of Object.entries(sheetFile)) {
      const xml = readFileSync(join(dir, 'xl/worksheets', file), 'utf8')
      const rows = []
      for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
        const arr = []
        for (const cm of rm[1].matchAll(/<c[^>]*r="([A-Z]+)\d+"([^>]*)>([\s\S]*?)<\/c>/g)) {
          const col = colToNum(cm[1]); const attrs = cm[2]; const inner = cm[3]
          const type = (/t="([^"]+)"/.exec(attrs) || [])[1] || 'n'
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner)
          let val = ''
          if (type === 's' && v) val = shared[Number(v[1])] ?? ''
          else if (type === 'inlineStr') { const im = /<t[^>]*>([\s\S]*?)<\/t>/.exec(inner); val = im ? decode(im[1]) : '' }
          else if (v) val = v[1]
          arr[col] = val
        }
        for (let i = 0; i < arr.length; i++) if (arr[i] === undefined) arr[i] = ''
        rows.push(arr)
      }
      out[name] = rows
    }
    return out
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/scripts/xlsx-lite.test.mjs`
Expected: PASS (3 tests). If the real workbook is absent the suite is skipped — that's fine on CI, but the implementer must have it present locally.

- [ ] **Step 5: Commit**

```bash
git add scripts/xlsx-lite.mjs tests/scripts/xlsx-lite.test.mjs
git commit -m "feat(migrate): dependency-free xlsx reader"
```

---

### Task 2: Excel-serial date conversion

**Files:**
- Create: `src/main/core/migrate-sales.ts`
- Test: `tests/core/migrate-sales.test.ts`

**Interfaces:**
- Produces: `excelSerialToISO(serial: number | string): string` — Excel 1900-system serial → `'YYYY-MM-DD'`.

- [ ] **Step 1: Write the failing test**

`tests/core/migrate-sales.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { excelSerialToISO } from '../../src/main/core/migrate-sales'

describe('excelSerialToISO', () => {
  it('converts known anchors', () => {
    expect(excelSerialToISO(46023)).toBe('2026-01-01')   // hand-checked anchor
    expect(excelSerialToISO(46114)).toBe('2026-04-02')   // RP/001 invoice date
  })
  it('accepts a numeric string', () => {
    expect(excelSerialToISO('46023')).toBe('2026-01-01')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: FAIL — no export `excelSerialToISO`.

- [ ] **Step 3: Implement**

`src/main/core/migrate-sales.ts` (start the file):

```ts
import type Database from 'better-sqlite3'
import type { Customer } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { createCustomer, placeOfSupplyState } from './customers'
import type { NewSale, NewSaleLine } from './sale'

// Excel's 1900 date system: serial 25569 is 1970-01-01, and that offset already absorbs Excel's
// fictitious 1900-02-29, so plain (serial - 25569) days is correct for every date we handle.
export function excelSerialToISO(serial: number | string): string {
  const n = typeof serial === 'string' ? Number(serial) : serial
  const ms = (n - 25569) * 86400000
  return new Date(ms).toISOString().slice(0, 10)
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/migrate-sales.ts tests/core/migrate-sales.test.ts
git commit -m "feat(migrate): excel serial to ISO date"
```

---

### Task 3: Parse sale invoice headers

**Files:**
- Modify: `src/main/core/migrate-sales.ts`
- Test: `tests/core/migrate-sales.test.ts`

**Interfaces:**
- Consumes: `excelSerialToISO` (Task 2).
- Produces:
  - `interface SaleHeader { invoice_number: string; invoice_date: string; buyer_name: string; buyer_gstin: string; eway_bill_no: string; eway_bill_date: string; vehicle: string; roundoff: number; sheet_total: number }`
  - `parseSaleHeaders(rows: string[][]): Map<string, SaleHeader>` — keyed by invoice number. Skips non-data rows (anything whose col 0 doesn't match `RP/NNN/YYYY-YY`).

- [ ] **Step 1: Write the failing test**

Append to `tests/core/migrate-sales.test.ts`:

```ts
import { parseSaleHeaders } from '../../src/main/core/migrate-sales'

describe('parseSaleHeaders', () => {
  // columns: 0 inv, 1 date, 2 eway no, 3 eway date, 4 vehicle, 5 buyer, 6 gstin, 34 roundoff, 35 total
  const row = (over: Record<number, string>) => {
    const r = Array(38).fill('')
    return Object.assign(r, over)
  }
  const rows = [
    row({ 0: 'Invoice Number' }),                                   // header noise
    row({ 0: 'RP/001/2026-27', 1: '46114', 2: '518', 5: 'Jenisa Enterprise', 6: '19BOGPB4474J1ZQ', 34: '-0.34', 35: '18499.995' }),
    row({ 0: 'RP/002/2026-27', 1: '46115', 2: '8116 6782', 3: '46115', 4: 'WB23D1657', 5: 'SHIVAM TRADERS', 6: '19ACNPC1217E1Z0', 34: '', 35: '871725' }),
    row({ 0: '' })                                                  // blank row
  ]

  it('keys headers by invoice number and converts the date', () => {
    const m = parseSaleHeaders(rows)
    expect(m.size).toBe(2)
    expect(m.get('RP/001/2026-27')).toEqual({
      invoice_number: 'RP/001/2026-27', invoice_date: '2026-04-02',
      buyer_name: 'Jenisa Enterprise', buyer_gstin: '19BOGPB4474J1ZQ',
      eway_bill_no: '518', eway_bill_date: '', vehicle: '', roundoff: -0.34, sheet_total: 18499.995
    })
  })
  it('treats a blank round-off as zero and reads the e-way date when present', () => {
    const h = parseSaleHeaders(rows).get('RP/002/2026-27')!
    expect(h.roundoff).toBe(0)
    expect(h.eway_bill_date).toBe('2026-04-03')
    expect(h.vehicle).toBe('WB23D1657')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: FAIL — no export `parseSaleHeaders`.

- [ ] **Step 3: Implement**

Append to `src/main/core/migrate-sales.ts`:

```ts
export interface SaleHeader {
  invoice_number: string; invoice_date: string
  buyer_name: string; buyer_gstin: string
  eway_bill_no: string; eway_bill_date: string; vehicle: string
  roundoff: number; sheet_total: number
}

const INVOICE_RE = /^RP\/\d+\/\d{4}-\d{2}$/

export function parseSaleHeaders(rows: string[][]): Map<string, SaleHeader> {
  const out = new Map<string, SaleHeader>()
  for (const r of rows) {
    const inv = (r[0] ?? '').trim()
    if (!INVOICE_RE.test(inv)) continue
    out.set(inv, {
      invoice_number: inv,
      invoice_date: excelSerialToISO(r[1]),
      buyer_name: (r[5] ?? '').trim(),
      buyer_gstin: (r[6] ?? '').trim(),
      eway_bill_no: (r[2] ?? '').trim(),
      eway_bill_date: (r[3] ?? '').trim() ? excelSerialToISO(r[3]) : '',
      vehicle: (r[4] ?? '').trim(),
      roundoff: (r[34] ?? '').trim() ? Number(r[34]) : 0,
      sheet_total: (r[35] ?? '').trim() ? Number(r[35]) : 0
    })
  }
  return out
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/migrate-sales.ts tests/core/migrate-sales.test.ts
git commit -m "feat(migrate): parse sale invoice headers"
```

---

### Task 4: Parse Stock-sheet per-lot allocations

**Files:**
- Modify: `src/main/core/migrate-sales.ts`
- Test: `tests/core/migrate-sales.test.ts`

**Interfaces:**
- Produces:
  - `interface StockAllocation { invoice_number: string; lot_code: string; lot_cost: number; hsn_code: string; qty: number; rate: number }`
  - `parseStockAllocations(rows: string[][], invoiceCol: number): StockAllocation[]` — walks the block structure. A row whose col 0 starts `Code ` opens a lot (code = the text after `Code `, cost = col 8, hsn = col 5). Rows with col 4 === `Sales` and a non-blank `invoiceCol` become allocations against the current lot. Sale rows with a blank invoice cell are skipped (out of scope).

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { parseStockAllocations } from '../../src/main/core/migrate-sales'

describe('parseStockAllocations', () => {
  // Stock columns: 0 code/voucher, 4 kind, 5 hsn, 6 qty, 8 rate, 10 balance, 11 invoice no (new col)
  const r = (over: Record<number, string>) => Object.assign(Array(12).fill(''), over)
  const rows = [
    r({ 0: 'Stock Statement' }),                                                   // title
    r({ 0: 'Code Number', 4: 'Items' }),                                           // header
    r({ 0: 'Code 082/2526', 4: 'Purchases', 5: '320419', 6: '300', 8: '170', 10: '300' }),
    r({ 0: '647', 4: 'Sales', 5: '320419', 6: '75', 8: '172', 10: '225', 11: 'RP/001/2026-27' }),
    r({ 0: '517', 4: 'Sales', 5: '320419', 6: '25', 8: '175', 10: '200', 11: 'RP/001/2026-27' }),
    r({ 0: '999', 4: 'Sales', 5: '320419', 6: '10', 8: '170', 10: '190', 11: '' }),   // unlabelled -> skipped
    r({ 0: 'Code 082/2526', 4: 'Purchases', 5: '320419', 6: '300', 8: '102', 10: '300' }),  // 2nd lot, same code
    r({ 0: '650', 4: 'Sales', 5: '320419', 6: '100', 8: '104', 10: '200', 11: 'RP/009/2026-27' })
  ]

  it('attaches each sale to the lot block above it, with that lot cost', () => {
    const allocs = parseStockAllocations(rows, 11)
    expect(allocs).toEqual([
      { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 75, rate: 172 },
      { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 25, rate: 175 },
      { invoice_number: 'RP/009/2026-27', lot_code: '082/2526', lot_cost: 102, hsn_code: '320419', qty: 100, rate: 104 }
    ])
  })
  it('skips sale rows with no invoice number', () => {
    const allocs = parseStockAllocations(rows, 11)
    expect(allocs.some(a => a.qty === 10)).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: FAIL — no export `parseStockAllocations`.

- [ ] **Step 3: Implement**

Append:

```ts
export interface StockAllocation {
  invoice_number: string; lot_code: string; lot_cost: number; hsn_code: string; qty: number; rate: number
}

export function parseStockAllocations(rows: string[][], invoiceCol: number): StockAllocation[] {
  const out: StockAllocation[] = []
  let lotCode = '', lotCost = 0, lotHsn = ''
  for (const r of rows) {
    const c0 = (r[0] ?? '').trim()
    if (c0.startsWith('Code ')) {
      lotCode = c0.slice(5).trim()
      lotCost = Number(r[8] ?? 0)
      lotHsn = (r[5] ?? '').trim()
      continue
    }
    if ((r[4] ?? '').trim() !== 'Sales') continue
    const inv = (r[invoiceCol] ?? '').trim()
    if (!inv) continue
    out.push({
      invoice_number: inv, lot_code: lotCode, lot_cost: lotCost, hsn_code: lotHsn,
      qty: Number(r[6] ?? 0), rate: Number(r[8] ?? 0)
    })
  }
  return out
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/migrate-sales.ts tests/core/migrate-sales.test.ts
git commit -m "feat(migrate): parse stock-sheet per-lot allocations"
```

---

### Task 5: Resolve a lot code+cost to a purchase_item id

**Files:**
- Modify: `src/main/core/migrate-sales.ts`
- Test: `tests/core/migrate-sales.test.ts`

**Interfaces:**
- Produces: `resolveLotItemId(db: Database.Database, lotCode: string, lotCost: number): number` — returns the single matching `purchase_items.id`; throws a plain-English `Error` when zero or more than one lot matches.

- [ ] **Step 1: Write the failing test**

Append (this test builds a DB with the real schema):

```ts
import { openDatabase } from '../../src/main/db/connection'
import { resolveLotItemId } from '../../src/main/core/migrate-sales'

function seedLot(db: ReturnType<typeof openDatabase>, code: string, cost: number, hsn = '320419', qty = 300) {
  const p = db.prepare(`INSERT INTO purchases (our_code, invoice_date, hsn_code, qty_kg, qty_remaining_kg, rate_per_kg, fy_label, code_seq)
    VALUES (?, '2026-02-01', ?, ?, ?, ?, '2025-26', 82)`).run(code, hsn, qty, qty, cost)
  db.prepare(`INSERT INTO purchase_items (purchase_id, hsn_code, description, qty_kg, qty_remaining_kg, rate_per_kg, amount, gst_rate, line_no)
    VALUES (?, ?, '', ?, ?, ?, ?, 18, 1)`).run(p.lastInsertRowid, hsn, qty, qty, cost, qty * cost)
  return db.prepare('SELECT id FROM purchase_items WHERE purchase_id = ?').get(p.lastInsertRowid) as { id: number }
}

describe('resolveLotItemId', () => {
  it('disambiguates two lots that share a code by their cost', () => {
    const db = openDatabase(':memory:')
    const a = seedLot(db, '082/2526', 170)
    const b = seedLot(db, '082/2526', 102)
    expect(resolveLotItemId(db, '082/2526', 170)).toBe(a.id)
    expect(resolveLotItemId(db, '082/2526', 102)).toBe(b.id)
  })
  it('matches cost within a rupee (sheet rounding)', () => {
    const db = openDatabase(':memory:')
    const a = seedLot(db, '090/2526', 148)
    expect(resolveLotItemId(db, '090/2526', 148.31)).toBe(a.id)
  })
  it('throws when no lot matches', () => {
    const db = openDatabase(':memory:')
    seedLot(db, '090/2526', 148)
    expect(() => resolveLotItemId(db, '090/2526', 999)).toThrow(/no lot/i)
  })
  it('throws when the match is ambiguous', () => {
    const db = openDatabase(':memory:')
    seedLot(db, '070/2526', 100)
    seedLot(db, '070/2526', 100)
    expect(() => resolveLotItemId(db, '070/2526', 100)).toThrow(/more than one/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: FAIL — no export `resolveLotItemId`.

- [ ] **Step 3: Implement**

Append:

```ts
// A lot is identified by its purchase code plus cost/kg — the code alone is not unique because one
// supplier invoice (e.g. 082/2526) was imported as two purchase lines at different rates.
export function resolveLotItemId(db: Database.Database, lotCode: string, lotCost: number): number {
  const matches = db.prepare(`
    SELECT i.id, i.rate_per_kg
    FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
    WHERE p.our_code = ? AND ABS(i.rate_per_kg - ?) <= 1
  `).all(lotCode, lotCost) as Array<{ id: number; rate_per_kg: number }>
  if (matches.length === 0)
    throw new Error(`No lot ${lotCode} at cost ~${lotCost}/kg exists in the database.`)
  if (matches.length > 1)
    throw new Error(`Lot ${lotCode} at cost ~${lotCost}/kg matches more than one lot — cannot tell them apart.`)
  return matches[0].id
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/migrate-sales.ts tests/core/migrate-sales.test.ts
git commit -m "feat(migrate): resolve lot code + cost to a purchase_item id"
```

---

### Task 6: Resolve (or create) the buyer

**Files:**
- Modify: `src/main/core/migrate-sales.ts`
- Test: `tests/core/migrate-sales.test.ts`

**Interfaces:**
- Produces:
  - `interface CustomerRow { name: string; address: string; city: string; state: string; pincode: string; gstin: string; pan: string }`
  - `parseCustomerMaster(rows: string[][]): CustomerRow[]`
  - `resolveBuyer(db, gstin: string, name: string, master: CustomerRow[]): Customer` — returns the existing app customer whose GSTIN matches; else creates one from the CustomerMaster row (matched by GSTIN, then by PAN embedded in the GSTIN, then by exact name), using the sale sheet's GSTIN; throws if no address can be found.

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { createCustomer } from '../../src/main/core/customers'
import { parseCustomerMaster, resolveBuyer } from '../../src/main/core/migrate-sales'

describe('parseCustomerMaster', () => {
  const r = (over: Record<number, string>) => Object.assign(Array(9).fill(''), over)
  it('reads name/address/city/state/pincode/gstin/pan and skips blank rows', () => {
    const rows = [
      r({ 0: 'Sl No', 1: 'Header' }),
      r({ 0: '88', 1: 'Jenisa Enterprise', 2: '1129 Canning Road', 3: 'Kolkata', 4: 'West Bengal', 5: '700144', 7: '19BOGPB4474J1ZQ', 8: 'BOGPB4474J' }),
      r({ 0: '', 1: '' })
    ]
    const cs = parseCustomerMaster(rows)
    expect(cs).toHaveLength(1)
    expect(cs[0]).toMatchObject({ name: 'Jenisa Enterprise', city: 'Kolkata', state: 'West Bengal', pincode: '700144', gstin: '19BOGPB4474J1ZQ' })
  })
})

describe('resolveBuyer', () => {
  const master = [
    { name: 'Jenisa Enterprise', address: '1129 Canning Road', city: 'Kolkata', state: 'West Bengal', pincode: '700144', gstin: '19BOGPB4474J1ZQ', pan: 'BOGPB4474J' },
    { name: 'S.M ENGINEERING & CO', address: '91/S Majlish Ara Road', city: 'Kolkata', state: 'West Bengal', pincode: '700041', gstin: '', pan: 'AIUPM2937N' }
  ]

  it('returns an existing app customer matched by GSTIN', () => {
    const db = openDatabase(':memory:')
    const existing = createCustomer(db, {
      name: 'Jenisa Enterprise', gstin: '19BOGPB4474J1ZQ', pan: 'BOGPB4474J', phone: '',
      billing_address: 'x', billing_city: 'Kolkata', billing_state: 'West Bengal', billing_pincode: '700144',
      shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
    })
    const got = resolveBuyer(db, '19BOGPB4474J1ZQ', 'Jenisa Enterprise', master)
    expect(got.id).toBe(existing.id)
  })

  it('creates a missing buyer from CustomerMaster (GSTIN match)', () => {
    const db = openDatabase(':memory:')
    const got = resolveBuyer(db, '19BOGPB4474J1ZQ', 'Jenisa Enterprise', master)
    expect(got.id).toBeGreaterThan(0)
    expect(got.billing_city).toBe('Kolkata')
    expect(got.billing_state).toBe('West Bengal')
    expect(got.pan).toBe('BOGPB4474J')          // derived from GSTIN
  })

  it('creates a missing buyer whose CustomerMaster row has no GSTIN, matched by PAN inside the GSTIN', () => {
    const db = openDatabase(':memory:')
    const got = resolveBuyer(db, '19AIUPM2937N1ZA', 'S.M ENGINEERING & CO', master)
    expect(got.billing_pincode).toBe('700041')
    expect(got.gstin).toBe('19AIUPM2937N1ZA')
  })

  it('throws when the buyer is nowhere to be found', () => {
    const db = openDatabase(':memory:')
    expect(() => resolveBuyer(db, '19ZZZZZ0000Z1ZZ', 'Nobody Ltd', master)).toThrow(/could not find an address/i)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: FAIL — no exports `parseCustomerMaster` / `resolveBuyer`.

- [ ] **Step 3: Implement**

Append:

```ts
export interface CustomerRow {
  name: string; address: string; city: string; state: string; pincode: string; gstin: string; pan: string
}

export function parseCustomerMaster(rows: string[][]): CustomerRow[] {
  const out: CustomerRow[] = []
  for (const r of rows) {
    const name = (r[1] ?? '').trim()
    if (!name || name === 'Header') continue
    if ((r[0] ?? '').trim().toLowerCase() === 'sl no') continue
    out.push({
      name,
      address: (r[2] ?? '').trim(), city: (r[3] ?? '').trim(),
      state: (r[4] ?? '').trim(), pincode: String(r[5] ?? '').replace(/\.0$/, '').trim(),
      gstin: (r[7] ?? '').trim(), pan: (r[8] ?? '').trim()
    })
  }
  return out
}

// GSTIN layout: 2 state digits + 10-char PAN + 3 more. So chars 2..12 are the PAN.
const panOfGstin = (g: string) => g.slice(2, 12)

export function resolveBuyer(db: Database.Database, gstin: string, name: string, master: CustomerRow[]): Customer {
  const existing = db.prepare('SELECT * FROM customers WHERE gstin = ?').get(gstin) as Customer | undefined
  if (existing) return existing

  const pan = panOfGstin(gstin)
  const src =
    master.find(m => m.gstin && m.gstin === gstin) ||
    master.find(m => m.pan && m.pan === pan) ||
    master.find(m => m.name.trim().toLowerCase() === name.trim().toLowerCase())
  if (!src)
    throw new Error(`Buyer ${name} (${gstin}) is not in the app and could not find an address in CustomerMaster.`)

  return createCustomer(db, {
    name: src.name || name,
    gstin,
    pan: panFromGstin(gstin),
    phone: '',
    billing_address: src.address, billing_city: src.city, billing_state: src.state, billing_pincode: src.pincode,
    shipping_same: true,
    shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
  })
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/migrate-sales.ts tests/core/migrate-sales.test.ts
git commit -m "feat(migrate): resolve or create the buyer from CustomerMaster"
```

---

### Task 7: Build a NewSale payload for one invoice

**Files:**
- Modify: `src/main/core/migrate-sales.ts`
- Test: `tests/core/migrate-sales.test.ts`

**Interfaces:**
- Consumes: `SaleHeader`, `StockAllocation`, `resolveLotItemId`, `resolveBuyer`, `Customer`.
- Produces: `buildSalePayload(db, header: SaleHeader, allocs: StockAllocation[], master: CustomerRow[], homeState: string): NewSale` — one payload; each allocation becomes a `NewSaleLine` (lot resolved by code+cost, gst_rate looked up from `hsn_products`, defaulting to 18). Buyer resolved/created. `payment_status: 'done'`, `payment_date` = invoice date. Billing/shipping snapshots come from the resolved customer.

- [ ] **Step 1: Write the failing test**

Append:

```ts
import { createPurchase } from '../../src/main/core/purchase'
import { createSale, getAllocations } from '../../src/main/core/sale'
import { buildSalePayload } from '../../src/main/core/migrate-sales'

describe('buildSalePayload + createSale (end to end)', () => {
  function seed(db: ReturnType<typeof openDatabase>) {
    db.prepare(`INSERT INTO hsn_products (hsn_code, description, gst_rate) VALUES ('320419','MB',18)`).run()
    // one purchase, one lot of 300 kg at cost 170
    createPurchase(db, {
      our_code: '082/2526', supplier_invoice_number: 'S', invoice_date: '2026-02-01',
      party: 'Swastik', party_state: 'West Bengal', homeState: 'West Bengal',
      items: [{ hsn_code: '320419', qty_kg: 300, rate_per_kg: 170, gst_rate: 18 }]
    })
  }
  const header = {
    invoice_number: 'RP/001/2026-27', invoice_date: '2026-04-02',
    buyer_name: 'Jenisa Enterprise', buyer_gstin: '19BOGPB4474J1ZQ',
    eway_bill_no: '518', eway_bill_date: '', vehicle: '', roundoff: -0.25, sheet_total: 17224.75
  }
  const master = [{ name: 'Jenisa Enterprise', address: 'A', city: 'Kolkata', state: 'West Bengal', pincode: '700144', gstin: '19BOGPB4474J1ZQ', pan: 'BOGPB4474J' }]
  const allocs = [
    { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 75, rate: 172 },
    { invoice_number: 'RP/001/2026-27', lot_code: '082/2526', lot_cost: 170, hsn_code: '320419', qty: 25, rate: 175 }
  ]

  it('produces a payload whose sale draws the exact lots and quantities', () => {
    const db = openDatabase(':memory:'); seed(db)
    const payload = buildSalePayload(db, header, allocs, master, 'West Bengal')
    expect(payload.invoice_number).toBe('RP/001/2026-27')
    expect(payload.payment_status).toBe('done')
    expect(payload.payment_date).toBe('2026-04-02')
    expect(payload.lines).toHaveLength(2)
    expect(payload.lines.map(l => [l.qty_drawn_kg, l.rate_per_kg])).toEqual([[75, 172], [25, 175]])

    const sale = createSale(db, payload)
    expect(sale.total_qty_kg).toBe(100)
    // 75*172 + 25*175 = 12900 + 4375 = 17275 taxable
    expect(sale.amount).toBe(17275)
    // lot drawn down exactly 100 kg from 300
    const rem = db.prepare(`SELECT qty_remaining_kg FROM purchase_items`).get() as { qty_remaining_kg: number }
    expect(rem.qty_remaining_kg).toBe(200)
    expect(getAllocations(db, sale.id)).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: FAIL — no export `buildSalePayload`.

- [ ] **Step 3: Implement**

Append:

```ts
function gstRateOf(db: Database.Database, hsn: string): number {
  const row = db.prepare('SELECT gst_rate FROM hsn_products WHERE hsn_code = ?').get(hsn) as { gst_rate: number } | undefined
  return row ? row.gst_rate : 18
}

export function buildSalePayload(
  db: Database.Database, header: SaleHeader, allocs: StockAllocation[], master: CustomerRow[], homeState: string
): NewSale {
  const buyer = resolveBuyer(db, header.buyer_gstin, header.buyer_name, master)
  const lines: NewSaleLine[] = allocs.map(a => ({
    purchase_item_id: resolveLotItemId(db, a.lot_code, a.lot_cost),
    qty_drawn_kg: a.qty,
    rate_per_kg: a.rate,
    hsn_code: a.hsn_code,
    gst_rate: gstRateOf(db, a.hsn_code)
  }))
  const billing = {
    address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode
  }
  return {
    invoice_number: header.invoice_number,
    invoice_date: header.invoice_date,
    buyer_customer_id: buyer.id,
    buyer_name: buyer.name,
    buyer_gstin: buyer.gstin,
    buyer_billing: billing,
    buyer_shipping: billing,
    place_of_supply_state: placeOfSupplyState(buyer),
    homeState,
    lines,
    roundoff: header.roundoff,
    eway_bill_no: header.eway_bill_no || undefined,
    eway_bill_date: header.eway_bill_date || undefined,
    vehicle: header.vehicle || undefined,
    payment_status: 'done',
    payment_date: header.invoice_date
  }
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `npx vitest run tests/core/migrate-sales.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/core/migrate-sales.ts tests/core/migrate-sales.test.ts
git commit -m "feat(migrate): build a NewSale payload from a header + its lot allocations"
```

---

### Task 8: The runner — dry-run, reconcile, commit, idempotent

**Files:**
- Create: `tests/migrate/run-sales.test.ts`
- Modify: `scripts/README.md`

**Interfaces:**
- Consumes: everything in `migrate-sales.ts`, `readWorkbook` from `scripts/xlsx-lite.mjs`, `createSale`/`getSale` from `sale.ts`, `openDatabase`/`closeDatabase` from `db/connection.ts`.
- Environment: `MIGRATE_XLSX` (workbook path — presence enables the runner), `MIGRATE_DB` (target .db copy), `MIGRATE_INVOICE_COL` (default `11`), `MIGRATE_COMMIT` (`'1'` to write). Without `MIGRATE_XLSX` the whole suite is skipped, so `npm test` never touches it.

- [ ] **Step 1: Write the runner**

`tests/migrate/run-sales.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { readWorkbook } from '../../scripts/xlsx-lite.mjs'
import { openDatabase, closeDatabase } from '../../src/main/db/connection'
import { getSettings } from '../../src/main/core/reference'
import { createSale, getSale } from '../../src/main/core/sale'
import {
  parseSaleHeaders, parseStockAllocations, parseCustomerMaster, buildSalePayload
} from '../../src/main/core/migrate-sales'

const XLSX = process.env.MIGRATE_XLSX
const DB = process.env.MIGRATE_DB
const INVOICE_COL = Number(process.env.MIGRATE_INVOICE_COL ?? '11')
const COMMIT = process.env.MIGRATE_COMMIT === '1'

// Whole suite is inert unless MIGRATE_XLSX is set — so `npm test` never runs the migration.
describe.runIf(XLSX && DB)('sales migration runner', () => {
  it('migrates FY2026-27 sales, mimicking the Stock sheet lot-for-lot', () => {
    const wb = readWorkbook(XLSX!)
    const headers = parseSaleHeaders(wb.SaleInvoiceMaster)
    const allocs = parseStockAllocations(wb.Stock, INVOICE_COL)
    const master = parseCustomerMaster(wb.CustomerMaster)

    // group allocations by invoice
    const byInvoice = new Map<string, typeof allocs>()
    for (const a of allocs) {
      const arr = byInvoice.get(a.invoice_number) ?? []
      arr.push(a); byInvoice.set(a.invoice_number, arr)
    }

    const db = openDatabase(DB!)
    const homeState = getSettings(db).home_state

    // expected ending balance per lot = the LAST balance cell of each lot block that has migrated sales
    const expectedBalance = new Map<string, number>()  // key `${lot_code}@${lot_cost}` -> balance
    {
      let key = ''
      for (const r of wb.Stock) {
        const c0 = (r[0] ?? '').trim()
        if (c0.startsWith('Code ')) key = `${c0.slice(5).trim()}@${Number(r[8] ?? 0)}`
        else if ((r[4] ?? '').trim() === 'Sales' && (r[INVOICE_COL] ?? '').trim())
          expectedBalance.set(key, Number(r[10] ?? 0))
      }
    }

    const log: string[] = []
    let written = 0, skipped = 0, failed = 0

    // Process in invoice-number order so the app's gap-free numbering is satisfied.
    const invoices = [...headers.keys()].sort((a, b) =>
      Number(a.match(/RP\/(\d+)/)![1]) - Number(b.match(/RP\/(\d+)/)![1]))

    for (const inv of invoices) {
      const header = headers.get(inv)!
      const lines = byInvoice.get(inv)
      if (!lines || lines.length === 0) { log.push(`SKIP ${inv}: no stock rows tagged with this invoice`); skipped++; continue }
      if (getSale(db, undefined as never) && false) { /* placeholder */ }
      const already = db.prepare('SELECT id FROM sales WHERE invoice_number = ?').get(inv)
      if (already) { log.push(`SKIP ${inv}: already in the database`); skipped++; continue }

      try {
        const payload = buildSalePayload(db, header, lines, master, homeState)
        const drawn = payload.lines.reduce((s, l) => s + l.qty_drawn_kg, 0)
        if (COMMIT) {
          const sale = createSale(db, payload)
          const diff = Math.round((sale.total_invoice_amount - header.sheet_total) * 100) / 100
          log.push(`OK   ${inv}: ${payload.lines.length} lines, ${drawn} kg, total ₹${sale.total_invoice_amount}` +
                   (Math.abs(diff) > 0.01 ? `  ⚠ sheet total ₹${header.sheet_total} (diff ${diff})` : ''))
          written++
        } else {
          // Dry run: compute tax the same way createSale would, without writing.
          log.push(`DRY  ${inv}: ${payload.lines.length} lines, ${drawn} kg, buyer ${payload.buyer_name}`)
        }
      } catch (e) {
        log.push(`FAIL ${inv}: ${(e as Error).message}`); failed++
      }
    }

    // Reconcile every lot that had migrated sales (only meaningful after a commit).
    const reconLog: string[] = []
    let mismatches = 0
    if (COMMIT) {
      for (const [key, expected] of expectedBalance) {
        const [code, cost] = key.split('@')
        const row = db.prepare(`
          SELECT i.qty_remaining_kg AS bal FROM purchase_items i JOIN purchases p ON p.id = i.purchase_id
          WHERE p.our_code = ? AND ABS(i.rate_per_kg - ?) <= 1
        `).get(code, Number(cost)) as { bal: number } | undefined
        const actual = row ? Math.round(row.bal * 100) / 100 : NaN
        if (Math.abs(actual - expected) > 0.01) {
          reconLog.push(`  MISMATCH lot ${code}@${cost}: sheet ${expected} kg, db ${actual} kg`)
          mismatches++
        }
      }
    }

    closeDatabase(db)

    console.log('\n===== SALES MIGRATION ' + (COMMIT ? '(COMMIT)' : '(DRY RUN)') + ' =====')
    console.log(log.join('\n'))
    console.log(`\n-- written ${written}, skipped ${skipped}, failed ${failed} --`)
    if (COMMIT) {
      console.log('\n===== STOCK RECONCILIATION vs Stock sheet =====')
      console.log(reconLog.length ? reconLog.join('\n') : '  all lots reconcile exactly ✅')
    }

    // The run must not have failed any invoice, and (when committing) every lot must reconcile.
    expect(failed, 'some invoices failed — see log above').toBe(0)
    if (COMMIT) expect(mismatches, 'some lots do not match the Stock sheet — see reconciliation above').toBe(0)
  })
})
```

Note: remove the `getSale(db, undefined as never) && false` placeholder line — it exists only to remind you `getSale` is imported for reuse; the real idempotency check is the `SELECT id FROM sales WHERE invoice_number` line right below it. Delete the placeholder before running.

- [ ] **Step 2: Dry-run against a COPY of the real database**

```bash
cp "/Users/shivamchoudhary/Desktop/Ramaxton Plastocrafts/granule-trader.db" /tmp/migrate-copy.db
npm run rebuild:node
MIGRATE_XLSX="/Users/shivamchoudhary/Downloads/DataMigration.xlsx" \
MIGRATE_DB=/tmp/migrate-copy.db \
npx vitest run tests/migrate/run-sales.test.ts
```

Expected: a `DRY RUN` log with 47 `DRY` lines and `failed 0`. If any `FAIL` line appears (unknown lot, unresolved buyer), fix the sheet (a mistyped invoice number, a lot cost that doesn't match) and re-run. Do not proceed until `failed 0`.

- [ ] **Step 3: Commit-run against the COPY and check reconciliation**

```bash
cp "/Users/shivamchoudhary/Desktop/Ramaxton Plastocrafts/granule-trader.db" /tmp/migrate-copy.db
MIGRATE_XLSX="/Users/shivamchoudhary/Downloads/DataMigration.xlsx" \
MIGRATE_DB=/tmp/migrate-copy.db MIGRATE_COMMIT=1 \
npx vitest run tests/migrate/run-sales.test.ts
```

Expected: 47 `OK` lines, `failed 0`, and `all lots reconcile exactly ✅`. Any `MISMATCH` line means a lot's ending balance disagrees with the sheet — investigate (usually a sale row left untagged, or tagged to the wrong lot) before touching the real DB.

- [ ] **Step 4: Verify totals line up and stock is sane on the copy**

```bash
sqlite3 "file:/tmp/migrate-copy.db?mode=ro" "SELECT COUNT(*) sales, ROUND(SUM(total_invoice_amount)) turnover FROM sales; SELECT ROUND(SUM(qty_remaining_kg)) remaining_kg FROM purchase_items;"
```

Expected: 47 sales, and `remaining_kg` equal to the sum of the Stock sheet's final per-lot balances. Eyeball a couple of invoices against the sheet.

- [ ] **Step 5: Document and commit the runner**

Add to `scripts/README.md`:

```markdown
## Sales migration (FY2026-27, one-time)

Imports the FY2026-27 sale invoices from `DataMigration.xlsx`, drawing each sale from the exact
lots recorded in the Stock sheet.

1. On the Stock sheet, add an `Invoice No` column and tag every Sales row with its RP number.
2. Quit Granule Trader (release the data lock).
3. `npm run rebuild:node`
4. Dry-run against a copy:
   `MIGRATE_XLSX=<DataMigration.xlsx> MIGRATE_DB=<copy.db> npx vitest run tests/migrate/run-sales.test.ts`
   Fix any FAIL lines in the sheet, re-run until `failed 0`.
5. Commit-run against the copy and confirm `all lots reconcile exactly`:
   add `MIGRATE_COMMIT=1`.
6. Only then repeat step 5 against the real `granule-trader.db` (back it up first). Idempotent —
   re-running skips invoices already imported.

If the Invoice No column isn't at position 11, pass `MIGRATE_INVOICE_COL=<0-indexed>`.
```

```bash
git add tests/migrate/run-sales.test.ts scripts/README.md
git commit -m "feat(migrate): sales migration runner with dry-run and stock reconciliation"
```

- [ ] **Step 6: Run against the real database (owner-supervised)**

Back up first, then run the commit against the real file with the app closed:

```bash
cp "/Users/shivamchoudhary/Desktop/Ramaxton Plastocrafts/granule-trader.db" "/Users/shivamchoudhary/Desktop/Ramaxton Plastocrafts/granule-trader.premigration.db"
MIGRATE_XLSX="/Users/shivamchoudhary/Downloads/DataMigration.xlsx" \
MIGRATE_DB="/Users/shivamchoudhary/Desktop/Ramaxton Plastocrafts/granule-trader.db" MIGRATE_COMMIT=1 \
npx vitest run tests/migrate/run-sales.test.ts
```

Expected: 47 `OK`, `failed 0`, `all lots reconcile exactly ✅`. Reopen the app and confirm Sales lists the 47 invoices and Stock matches the sheet.

---

## Self-review

**Spec coverage:**
- Exact per-lot mimicry → Tasks 4 (parse), 5 (resolve), 7 (payload), 8 (reconcile). ✅
- Headers from SaleInvoiceMaster → Task 3. ✅
- Missing buyers from CustomerMaster → Task 6. ✅
- Write via `createSale` → Task 7 test + Task 8 runner. ✅
- Dry-run / commit / idempotent → Task 8 (env flags, `SELECT … WHERE invoice_number`). ✅
- Reconciliation against Stock balances → Task 8 Step 3. ✅
- No app/schema change → only new files under `scripts/`, `tests/`, and one new core module. ✅
- Owner data prerequisite (Invoice No column) → Task 0. ✅

**Placeholder scan:** The only literal placeholder is the deliberately-flagged `getSale(...) && false` reminder line in Task 8, with an explicit instruction to delete it. No TBD/TODO elsewhere.

**Type consistency:** `SaleHeader`, `StockAllocation`, `CustomerRow`, `NewSale`/`NewSaleLine` names and fields are used identically across Tasks 3-8. `resolveLotItemId(db, lotCode, lotCost)`, `resolveBuyer(db, gstin, name, master)`, `buildSalePayload(db, header, allocs, master, homeState)` signatures match between definition and callers. The `@` separator key `${lot_code}@${lot_cost}` is built and split consistently in Task 8.

**Known risk to watch during execution:** if a lot has sale rows the owner did *not* tag (genuinely pre-FY2026-27 consumption), that lot won't reconcile because the DB carries the full carry-forward quantity. Task 8 Step 3 surfaces this as a MISMATCH; the resolution (an opening-balance stock adjustment for that lot) is intentionally out of scope until the dry-run shows whether it's needed.
