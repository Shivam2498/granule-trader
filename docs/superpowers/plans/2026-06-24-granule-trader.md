# Granule Trader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a senior-friendly cross-platform desktop app (Electron) that replaces an Excel workflow for a plastic-granules trading business: purchases, sales, customers, derived stock, and printable/PDF GST invoices.

**Architecture:** Three layers. (1) **Storage** — a single SQLite file via `better-sqlite3`, owned by the main process. (2) **Core logic** — pure TypeScript in the main process (tax, numbering, stock draw-down, backups), unit-tested with no UI. (3) **UI** — a React/TS renderer that never touches SQLite directly and calls core logic only through a typed IPC bridge (`window.api`).

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, `better-sqlite3`, React Router, Vitest, `@testing-library/react` + jsdom.

## Global Constraints

- **Platforms:** must run identically on macOS and Windows. No platform-specific paths — use Electron's `app.getPath` and `path.join`.
- **Layering rule:** the renderer never imports `better-sqlite3` or `fs`/`path` for data. All data access goes through `window.api.*` (IPC). Core logic lives under `src/main/core` and `src/main/db` and imports no React.
- **Money:** amounts stored in rupees as REAL with 2-decimal precision; always pass through `round2()` before storing or comparing. Quantities in kg (REAL).
- **Financial year:** April–March. FY label format `2024-25`; FY short code `2425`.
- **Purchase code format:** `NNNN/YYYY` e.g. `0022/2425` (4-digit zero-padded sequence, FY short code), editable, resets each FY.
- **Sales invoice format:** `PREFIX/NNN/2024-25` e.g. `RP/008/2024-25` (3-digit zero-padded sequence within FY), editable.
- **SQLite mode:** rollback journal (NOT WAL); connection closed cleanly on exit (cloud-sync safety).
- **Tax rule:** place of supply = buyer shipping state (fallback billing). Equals home state → CGST+SGST (split the HSN rate in half each). Otherwise → IGST (full rate). Never both.
- **Atomicity:** any operation that changes stock runs in a single DB transaction — all-or-nothing.
- **Theme:** light only; explicit white input backgrounds + dark text so OS dark mode never renders black input boxes. Base font ~18px, headings to 30px, big buttons.
- **TDD:** write the failing test first, watch it fail, implement minimally, watch it pass, commit.

---

## File Structure

```
package.json, electron.vite.config.ts, tsconfig.json, vitest.config.ts
src/
  shared/
    types.ts          # domain types shared by main + renderer
    api.ts            # the IPC Api interface (contract)
  main/
    index.ts          # app bootstrap: window, folder pick, open db, lock, backup, IPC wiring
    ipc.ts            # registers ipcMain.handle(...) -> core functions
    db/
      schema.ts       # SCHEMA_SQL + initSchema(db)
      connection.ts   # openDatabase/closeDatabase (rollback journal)
    core/
      money.ts            # round2
      financial-year.ts   # financialYear(date)
      tax.ts              # computeTax
      purchase.ts         # nextPurchaseCode, createPurchase, listPurchases, updatePurchase, deletePurchase
      invoice-number.ts   # parse/format/next invoice number
      invoice-validation.ts # gap reservation + monotonic date<->number validation
      available-lots.ts   # listAvailableLots(asOfDate)
      sale.ts             # createSale (atomic), listSales, fillReservedSale, deleteSale
      adjustment.ts       # createStockAdjustment, stockLedger
      customers.ts        # CRUD
      reference.ts        # hsn_products + settings get/set
      backup.ts           # createBackup, lock file acquire/release
  preload/
    index.ts          # contextBridge -> window.api (typed)
  renderer/
    main.tsx, App.tsx, routes.tsx
    theme.css
    components/ (Sidebar, KpiCard, DataTable, MoneyInput, etc.)
    screens/ (Dashboard, Purchases, Sales, NewSale, Stock, Customers, Settings, FirstRun)
    invoice/InvoiceTemplate.tsx + invoice.css
tests/  (mirrors src/main/core and selected components)
scripts/migrate-excel.ts   # one-time importer (Future-adjacent; stub only in v1)
```

---

## Phase 0 — Scaffold

### Task 1: Project scaffold (electron-vite + React + TS + Vitest)

**Files:**
- Create: `package.json`, `electron.vite.config.ts`, `tsconfig.json`, `tsconfig.node.json`, `vitest.config.ts`
- Create: `src/main/index.ts`, `src/preload/index.ts`, `src/renderer/index.html`, `src/renderer/main.tsx`, `src/renderer/App.tsx`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Produces: a runnable Electron app (`npm run dev`) and a working `npm test` (Vitest).

- [ ] **Step 1: Initialize package.json**

```json
{
  "name": "granule-trader",
  "version": "0.1.0",
  "description": "Desktop trading app for a plastic granules business",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "start": "electron-vite preview",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "devDependencies": {
    "@testing-library/react": "^16.0.0",
    "@types/better-sqlite3": "^7.6.11",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "jsdom": "^24.1.0",
    "typescript": "^5.5.0",
    "vite": "^5.3.0",
    "vitest": "^2.0.0"
  },
  "dependencies": {
    "better-sqlite3": "^11.1.2",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.24.0"
  }
}
```

- [ ] **Step 2: Add config files**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "module": "ESNext", "moduleResolution": "Bundler",
    "strict": true, "esModuleInterop": true, "skipLibCheck": true,
    "jsx": "react-jsx", "resolveJsonModule": true, "noEmit": true,
    "baseUrl": ".", "paths": { "@shared/*": ["src/shared/*"] }
  },
  "include": ["src", "tests"]
}
```

`electron.vite.config.ts`:
```ts
import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    plugins: [react()],
    resolve: { alias: { '@shared': resolve('src/shared') } }
  }
})
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import { resolve } from 'path'
export default defineConfig({
  test: { environment: 'node', include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'] },
  resolve: { alias: { '@shared': resolve('src/shared') } }
})
```

- [ ] **Step 3: Minimal main + renderer**

`src/main/index.ts`:
```ts
import { app, BrowserWindow } from 'electron'
import { join } from 'path'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

`src/preload/index.ts`:
```ts
import { contextBridge } from 'electron'
contextBridge.exposeInMainWorld('api', {})
```

`src/renderer/index.html`:
```html
<!doctype html><html><head><meta charset="utf-8" /><title>Granule Trader</title></head>
<body><div id="root"></div><script type="module" src="./main.tsx"></script></body></html>
```

`src/renderer/main.tsx`:
```tsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
createRoot(document.getElementById('root')!).render(<App />)
```

`src/renderer/App.tsx`:
```tsx
export default function App() { return <h1>Granule Trader</h1> }
```

- [ ] **Step 4: Write a smoke test**

`tests/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
describe('smoke', () => { it('runs', () => { expect(1 + 1).toBe(2) }) })
```

- [ ] **Step 5: Install, test, and verify dev boots**

Run: `npm install && npm test`
Expected: 1 test passes.
Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "chore: scaffold electron-vite + react + ts + vitest"
```

---

## Phase 1 — Shared types & storage

### Task 2: Shared domain types + money helper

**Files:**
- Create: `src/shared/types.ts`, `src/main/core/money.ts`
- Test: `tests/core/money.test.ts`

**Interfaces:**
- Produces: `round2(n: number): number` — rounds to 2 decimals, avoiding float drift.
- Produces: shared types consumed by every later task (see Step 1).

- [ ] **Step 1: Define shared types**

`src/shared/types.ts`:
```ts
export type PaymentStatus = 'pending' | 'done'
export type SaleStatus = 'reserved' | 'created'

export interface Purchase {
  id: number
  our_code: string
  supplier_invoice_number: string
  invoice_date: string          // 'YYYY-MM-DD'
  party: string
  party_state: string
  hsn_code: string
  qty_kg: number
  qty_remaining_kg: number
  amount: number
  cgst: number
  sgst: number
  igst: number
  tcs: number
  roundoff: number
  total_invoice_amount: number
  payment_status: PaymentStatus
  payment_date: string | null
  fy_label: string
  code_seq: number
  created_at: string
}

export interface Customer {
  id: number
  name: string
  gstin: string
  pan: string
  phone: string
  billing_address: string
  billing_city: string
  billing_state: string
  billing_pincode: string
  shipping_same: boolean
  shipping_address: string
  shipping_city: string
  shipping_state: string
  shipping_pincode: string
}

export interface SaleAllocation {
  id: number
  sale_id: number
  purchase_id: number
  qty_drawn_kg: number
  rate_per_kg: number
  line_amount: number
}

export interface Sale {
  id: number
  invoice_number: string
  prefix: string
  seq: number
  fy_label: string
  status: SaleStatus
  invoice_date: string | null
  eway_bill_no: string | null
  eway_bill_date: string | null
  vehicle: string | null
  buyer_customer_id: number | null
  buyer_name: string
  buyer_gstin: string
  buyer_billing_json: string     // snapshot JSON of address block
  buyer_shipping_json: string
  hsn_code: string
  amount: number
  cgst: number
  sgst: number
  igst: number
  tcs: number
  roundoff: number
  total_invoice_amount: number
  total_qty_kg: number
  payment_status: PaymentStatus
  payment_date: string | null
  created_at: string
}

export interface StockAdjustment {
  id: number
  purchase_id: number
  qty_kg: number
  reason: string
  date: string
  created_at: string
}

export interface HsnProduct { hsn_code: string; description: string; gst_rate: number }

export interface Settings {
  seller_name: string
  seller_address: string
  seller_gstin: string
  seller_pan: string
  home_state: string
  invoice_prefix: string
  default_gst_rate: number
  data_folder: string
  low_stock_threshold: number
  backups_to_keep: number
}

export interface TaxResult {
  taxable_amount: number
  cgst: number
  sgst: number
  igst: number
  tcs: number
  roundoff: number
  total: number
}

export interface AvailableLot {
  purchase_id: number
  our_code: string
  party: string
  hsn_code: string
  invoice_date: string
  available_kg: number
}

export interface LedgerRow {
  purchase_id: number
  our_code: string
  hsn_code: string
  party: string
  invoice_date: string
  qty_kg: number
  consumed_kg: number
  balance_kg: number
}
```

- [ ] **Step 2: Write the failing test**

`tests/core/money.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { round2 } from '../../src/main/core/money'

describe('round2', () => {
  it('rounds to two decimals', () => { expect(round2(1.005)).toBe(1.01) })
  it('removes float drift', () => { expect(round2(0.1 + 0.2)).toBe(0.3) })
  it('leaves whole numbers', () => { expect(round2(100)).toBe(100) })
})
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run tests/core/money.test.ts`
Expected: FAIL — cannot find module `money`.

- [ ] **Step 4: Implement**

`src/main/core/money.ts`:
```ts
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run tests/core/money.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/shared/types.ts src/main/core/money.ts tests/core/money.test.ts
git commit -m "feat: shared domain types + round2 money helper"
```

---

### Task 3: Financial-year helper

**Files:**
- Create: `src/main/core/financial-year.ts`
- Test: `tests/core/financial-year.test.ts`

**Interfaces:**
- Produces: `financialYear(date: string): { startYear: number; endYear: number; code: string; label: string }`. Input is `'YYYY-MM-DD'`. FY runs April (month 04) through March. `code` = last two digits of each year joined (`'2425'`); `label` = `'2024-25'`.

- [ ] **Step 1: Write the failing test**

`tests/core/financial-year.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { financialYear } from '../../src/main/core/financial-year'

describe('financialYear', () => {
  it('April starts a new FY', () => {
    expect(financialYear('2024-04-01')).toEqual({ startYear: 2024, endYear: 2025, code: '2425', label: '2024-25' })
  })
  it('March belongs to the prior FY start', () => {
    expect(financialYear('2025-03-31')).toEqual({ startYear: 2024, endYear: 2025, code: '2425', label: '2024-25' })
  })
  it('January belongs to the prior FY start', () => {
    expect(financialYear('2025-01-15').label).toBe('2024-25')
  })
  it('December belongs to the current FY start', () => {
    expect(financialYear('2024-12-15').label).toBe('2024-25')
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/financial-year.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/financial-year.ts`:
```ts
export function financialYear(date: string): { startYear: number; endYear: number; code: string; label: string } {
  const [yStr, mStr] = date.split('-')
  const year = Number(yStr)
  const month = Number(mStr)
  const startYear = month >= 4 ? year : year - 1
  const endYear = startYear + 1
  const code = `${String(startYear).slice(2)}${String(endYear).slice(2)}`
  const label = `${startYear}-${String(endYear).slice(2)}`
  return { startYear, endYear, code, label }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/financial-year.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/financial-year.ts tests/core/financial-year.test.ts
git commit -m "feat: financial-year helper (April-March)"
```

---

### Task 4: SQLite schema + connection

**Files:**
- Create: `src/main/db/schema.ts`, `src/main/db/connection.ts`
- Test: `tests/db/schema.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `initSchema(db: Database.Database): void` — creates all tables if absent.
  - `openDatabase(dbPath: string): Database.Database` — opens with rollback journal, foreign keys on, runs `initSchema`.
  - `closeDatabase(db: Database.Database): void`.
  - Test helper pattern: `openDatabase(':memory:')` gives a ready in-memory DB used by every core test below.

- [ ] **Step 1: Write the failing test**

`tests/db/schema.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'

describe('schema', () => {
  it('creates all core tables', () => {
    const db = openDatabase(':memory:')
    const names = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).all().map((r: any) => r.name)
    for (const t of ['customers','hsn_products','purchases','sale_allocations','sales','settings','stock_adjustments'])
      expect(names).toContain(t)
    db.close()
  })

  it('enforces foreign keys', () => {
    const db = openDatabase(':memory:')
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
    db.close()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement schema**

`src/main/db/schema.ts`:
```ts
import type Database from 'better-sqlite3'

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS hsn_products (
  hsn_code TEXT PRIMARY KEY,
  description TEXT NOT NULL DEFAULT '',
  gst_rate REAL NOT NULL DEFAULT 18
);

CREATE TABLE IF NOT EXISTS customers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gstin TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  billing_address TEXT NOT NULL DEFAULT '',
  billing_city TEXT NOT NULL DEFAULT '',
  billing_state TEXT NOT NULL DEFAULT '',
  billing_pincode TEXT NOT NULL DEFAULT '',
  shipping_same INTEGER NOT NULL DEFAULT 1,
  shipping_address TEXT NOT NULL DEFAULT '',
  shipping_city TEXT NOT NULL DEFAULT '',
  shipping_state TEXT NOT NULL DEFAULT '',
  shipping_pincode TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS purchases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  our_code TEXT NOT NULL,
  supplier_invoice_number TEXT NOT NULL DEFAULT '',
  invoice_date TEXT NOT NULL,
  party TEXT NOT NULL DEFAULT '',
  party_state TEXT NOT NULL DEFAULT '',
  hsn_code TEXT NOT NULL DEFAULT '',
  qty_kg REAL NOT NULL,
  qty_remaining_kg REAL NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  cgst REAL NOT NULL DEFAULT 0,
  sgst REAL NOT NULL DEFAULT 0,
  igst REAL NOT NULL DEFAULT 0,
  tcs REAL NOT NULL DEFAULT 0,
  roundoff REAL NOT NULL DEFAULT 0,
  total_invoice_amount REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_date TEXT,
  fy_label TEXT NOT NULL,
  code_seq INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  prefix TEXT NOT NULL DEFAULT '',
  seq INTEGER NOT NULL,
  fy_label TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  invoice_date TEXT,
  eway_bill_no TEXT,
  eway_bill_date TEXT,
  vehicle TEXT,
  buyer_customer_id INTEGER REFERENCES customers(id),
  buyer_name TEXT NOT NULL DEFAULT '',
  buyer_gstin TEXT NOT NULL DEFAULT '',
  buyer_billing_json TEXT NOT NULL DEFAULT '{}',
  buyer_shipping_json TEXT NOT NULL DEFAULT '{}',
  hsn_code TEXT NOT NULL DEFAULT '',
  amount REAL NOT NULL DEFAULT 0,
  cgst REAL NOT NULL DEFAULT 0,
  sgst REAL NOT NULL DEFAULT 0,
  igst REAL NOT NULL DEFAULT 0,
  tcs REAL NOT NULL DEFAULT 0,
  roundoff REAL NOT NULL DEFAULT 0,
  total_invoice_amount REAL NOT NULL DEFAULT 0,
  total_qty_kg REAL NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(fy_label, seq)
);

CREATE TABLE IF NOT EXISTS sale_allocations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  qty_drawn_kg REAL NOT NULL,
  rate_per_kg REAL NOT NULL,
  line_amount REAL NOT NULL
);

CREATE TABLE IF NOT EXISTS stock_adjustments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  purchase_id INTEGER NOT NULL REFERENCES purchases(id),
  qty_kg REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  date TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_alloc_sale ON sale_allocations(sale_id);
CREATE INDEX IF NOT EXISTS idx_alloc_purchase ON sale_allocations(purchase_id);
CREATE INDEX IF NOT EXISTS idx_adj_purchase ON stock_adjustments(purchase_id);
`

export function initSchema(db: Database.Database): void {
  db.exec(SCHEMA_SQL)
}
```

> **Note on `settings`:** stored as key/value rows; `reference.ts` (Task 12) reads/writes the typed `Settings` shape on top of this table.

- [ ] **Step 4: Implement connection**

`src/main/db/connection.ts`:
```ts
import Database from 'better-sqlite3'
import { initSchema } from './schema'

export function openDatabase(dbPath: string): Database.Database {
  const db = new Database(dbPath)
  db.pragma('journal_mode = DELETE')   // rollback journal, NOT WAL (cloud-sync safe)
  db.pragma('foreign_keys = ON')
  initSchema(db)
  return db
}

export function closeDatabase(db: Database.Database): void {
  db.close()
}
```

- [ ] **Step 5: Run test, verify it passes**

Run: `npx vitest run tests/db/schema.test.ts`
Expected: PASS (2 tests). (`:memory:` ignores journal_mode but pragma call is harmless.)

- [ ] **Step 6: Commit**

```bash
git add src/main/db/ tests/db/schema.test.ts
git commit -m "feat: sqlite schema + connection (rollback journal, FKs on)"
```

---

## Phase 2 — Core logic (pure, fully tested)

### Task 5: Tax calculation

**Files:**
- Create: `src/main/core/tax.ts`
- Test: `tests/core/tax.test.ts`

**Interfaces:**
- Produces: `computeTax(input): TaxResult` where
  ```ts
  interface ComputeTaxInput {
    amount: number; gstRate: number;
    placeOfSupplyState: string; homeState: string;
    tcs?: number; roundoff?: number;
  }
  ```
  Intra-state (placeOfSupply === home): `cgst = sgst = round2(amount * rate/2 / 100)`, `igst = 0`. Inter-state: `igst = round2(amount * rate / 100)`, `cgst = sgst = 0`. `total = round2(amount + cgst + sgst + igst + tcs + roundoff)`. State comparison is case-insensitive + trimmed.

- [ ] **Step 1: Write the failing test**

`tests/core/tax.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { computeTax } from '../../src/main/core/tax'

describe('computeTax', () => {
  it('intra-state splits into CGST + SGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Gujarat', homeState: 'Gujarat' })
    expect(r).toMatchObject({ cgst: 90, sgst: 90, igst: 0, total: 1180 })
  })
  it('inter-state applies IGST', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Maharashtra', homeState: 'Gujarat' })
    expect(r).toMatchObject({ cgst: 0, sgst: 0, igst: 180, total: 1180 })
  })
  it('state match is case-insensitive', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: ' gujarat ', homeState: 'Gujarat' })
    expect(r.igst).toBe(0)
    expect(r.cgst).toBe(90)
  })
  it('adds tcs and roundoff to total', () => {
    const r = computeTax({ amount: 1000, gstRate: 18, placeOfSupplyState: 'Gujarat', homeState: 'Gujarat', tcs: 5, roundoff: 0.4 })
    expect(r.total).toBe(1185.4)
  })
  it('respects a non-default rate', () => {
    const r = computeTax({ amount: 1000, gstRate: 5, placeOfSupplyState: 'Goa', homeState: 'Gujarat' })
    expect(r.igst).toBe(50)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/tax.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/tax.ts`:
```ts
import { round2 } from './money'
import type { TaxResult } from '@shared/types'

export interface ComputeTaxInput {
  amount: number
  gstRate: number
  placeOfSupplyState: string
  homeState: string
  tcs?: number
  roundoff?: number
}

export function computeTax(input: ComputeTaxInput): TaxResult {
  const { amount, gstRate } = input
  const tcs = input.tcs ?? 0
  const roundoff = input.roundoff ?? 0
  const intra = input.placeOfSupplyState.trim().toLowerCase() === input.homeState.trim().toLowerCase()
  const cgst = intra ? round2((amount * gstRate) / 2 / 100) : 0
  const sgst = cgst
  const igst = intra ? 0 : round2((amount * gstRate) / 100)
  const total = round2(amount + cgst + sgst + igst + tcs + roundoff)
  return { taxable_amount: round2(amount), cgst, sgst, igst, tcs: round2(tcs), roundoff: round2(roundoff), total }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/tax.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/tax.ts tests/core/tax.test.ts
git commit -m "feat: GST tax calculation (intra CGST+SGST / inter IGST)"
```

---

### Task 6: Purchase code numbering + purchase CRUD

**Files:**
- Create: `src/main/core/purchase.ts`
- Test: `tests/core/purchase.test.ts`

**Interfaces:**
- Consumes: `openDatabase`, `financialYear`, `computeTax`, `round2`.
- Produces:
  - `nextPurchaseCode(db, date: string): string` — `NNNN/YYYY` for the FY of `date`; max `code_seq` in that FY + 1, zero-padded to 4; resets per FY.
  - `createPurchase(db, input: NewPurchase): Purchase` — computes tax from `party_state` vs `homeState`, sets `qty_remaining_kg = qty_kg`, derives `fy_label`/`code_seq` from the (possibly edited) `our_code`. Auto-creates the `hsn_products` row if missing.
  - `listPurchases(db): Purchase[]`, `getPurchase(db, id): Purchase | undefined`.
  - `updatePurchase(db, id, input): Purchase`, `deletePurchase(db, id): void` (blocks delete if allocations reference it).
  ```ts
  interface NewPurchase {
    our_code: string; supplier_invoice_number: string; invoice_date: string;
    party: string; party_state: string; hsn_code: string;
    qty_kg: number; amount: number; gst_rate: number; homeState: string;
    igst_manual?: number; tcs?: number; roundoff?: number;
    payment_status?: 'pending' | 'done'; payment_date?: string | null;
  }
  ```
  `parsePurchaseSeq(code: string): number` — extracts the leading `NNNN` integer.

- [ ] **Step 1: Write the failing test**

`tests/core/purchase.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { nextPurchaseCode, createPurchase, listPurchases, deletePurchase } from '../../src/main/core/purchase'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const base = {
  supplier_invoice_number: 'S-1', party: 'Acme', party_state: 'Gujarat',
  hsn_code: '3902', qty_kg: 1000, amount: 50000, gst_rate: 18, homeState: 'Gujarat'
}

describe('nextPurchaseCode', () => {
  it('starts at 0001 for an empty FY', () => {
    expect(nextPurchaseCode(db, '2024-05-01')).toBe('0001/2425')
  })
  it('increments within the FY and resets next FY', () => {
    createPurchase(db, { ...base, our_code: nextPurchaseCode(db, '2024-05-01'), invoice_date: '2024-05-01' })
    expect(nextPurchaseCode(db, '2024-06-01')).toBe('0002/2425')
    expect(nextPurchaseCode(db, '2025-04-02')).toBe('0001/2526')
  })
})

describe('createPurchase', () => {
  it('sets remaining = qty and computes intra-state tax', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(p.qty_remaining_kg).toBe(1000)
    expect(p.cgst).toBe(4500)
    expect(p.sgst).toBe(4500)
    expect(p.total_invoice_amount).toBe(59000)
  })
})

describe('deletePurchase', () => {
  it('lists then deletes a purchase with no allocations', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01' })
    expect(listPurchases(db)).toHaveLength(1)
    deletePurchase(db, p.id)
    expect(listPurchases(db)).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/purchase.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/purchase.ts`:
```ts
import type Database from 'better-sqlite3'
import type { Purchase } from '@shared/types'
import { financialYear } from './financial-year'
import { computeTax } from './tax'
import { round2 } from './money'

export interface NewPurchase {
  our_code: string; supplier_invoice_number: string; invoice_date: string
  party: string; party_state: string; hsn_code: string
  qty_kg: number; amount: number; gst_rate: number; homeState: string
  igst_manual?: number; tcs?: number; roundoff?: number
  payment_status?: 'pending' | 'done'; payment_date?: string | null
}

export function parsePurchaseSeq(code: string): number {
  const m = code.match(/(\d+)/)
  return m ? Number(m[1]) : 0
}

export function nextPurchaseCode(db: Database.Database, date: string): string {
  const fy = financialYear(date)
  const row = db.prepare('SELECT MAX(code_seq) AS m FROM purchases WHERE fy_label = ?').get(fy.label) as { m: number | null }
  const next = (row.m ?? 0) + 1
  return `${String(next).padStart(4, '0')}/${fy.code}`
}

function ensureHsn(db: Database.Database, hsn: string, rate: number): void {
  if (!hsn) return
  db.prepare('INSERT OR IGNORE INTO hsn_products (hsn_code, description, gst_rate) VALUES (?, ?, ?)').run(hsn, '', rate)
}

export function createPurchase(db: Database.Database, input: NewPurchase): Purchase {
  const fy = financialYear(input.invoice_date)
  const tax = computeTax({
    amount: input.amount, gstRate: input.gst_rate,
    placeOfSupplyState: input.party_state, homeState: input.homeState,
    tcs: input.tcs, roundoff: input.roundoff
  })
  ensureHsn(db, input.hsn_code, input.gst_rate)
  const info = db.prepare(`
    INSERT INTO purchases (our_code, supplier_invoice_number, invoice_date, party, party_state, hsn_code,
      qty_kg, qty_remaining_kg, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
      payment_status, payment_date, fy_label, code_seq)
    VALUES (@our_code, @supplier_invoice_number, @invoice_date, @party, @party_state, @hsn_code,
      @qty_kg, @qty_remaining_kg, @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount,
      @payment_status, @payment_date, @fy_label, @code_seq)`).run({
    our_code: input.our_code, supplier_invoice_number: input.supplier_invoice_number,
    invoice_date: input.invoice_date, party: input.party, party_state: input.party_state,
    hsn_code: input.hsn_code, qty_kg: round2(input.qty_kg), qty_remaining_kg: round2(input.qty_kg),
    amount: tax.taxable_amount, cgst: tax.cgst, sgst: tax.sgst,
    igst: input.igst_manual != null ? round2(input.igst_manual) : tax.igst,
    tcs: tax.tcs, roundoff: tax.roundoff, total_invoice_amount: tax.total,
    payment_status: input.payment_status ?? 'pending', payment_date: input.payment_date ?? null,
    fy_label: fy.label, code_seq: parsePurchaseSeq(input.our_code)
  })
  return getPurchase(db, Number(info.lastInsertRowid))!
}

export function getPurchase(db: Database.Database, id: number): Purchase | undefined {
  return db.prepare('SELECT * FROM purchases WHERE id = ?').get(id) as Purchase | undefined
}

export function listPurchases(db: Database.Database): Purchase[] {
  return db.prepare('SELECT * FROM purchases ORDER BY invoice_date DESC, id DESC').all() as Purchase[]
}

export function updatePurchase(db: Database.Database, id: number, input: NewPurchase): Purchase {
  const existing = getPurchase(db, id)
  if (!existing) throw new Error('Purchase not found')
  const consumed = round2(existing.qty_kg - existing.qty_remaining_kg)
  if (round2(input.qty_kg) < consumed)
    throw new Error(`Quantity cannot be below ${consumed} kg already drawn from this lot`)
  const fy = financialYear(input.invoice_date)
  const tax = computeTax({
    amount: input.amount, gstRate: input.gst_rate,
    placeOfSupplyState: input.party_state, homeState: input.homeState,
    tcs: input.tcs, roundoff: input.roundoff
  })
  ensureHsn(db, input.hsn_code, input.gst_rate)
  db.prepare(`UPDATE purchases SET our_code=@our_code, supplier_invoice_number=@sin, invoice_date=@d,
    party=@party, party_state=@ps, hsn_code=@hsn, qty_kg=@qty, qty_remaining_kg=@rem, amount=@amt,
    cgst=@cgst, sgst=@sgst, igst=@igst, tcs=@tcs, roundoff=@ro, total_invoice_amount=@tot,
    payment_status=@pst, payment_date=@pd, fy_label=@fy, code_seq=@seq WHERE id=@id`).run({
    id, our_code: input.our_code, sin: input.supplier_invoice_number, d: input.invoice_date,
    party: input.party, ps: input.party_state, hsn: input.hsn_code, qty: round2(input.qty_kg),
    rem: round2(round2(input.qty_kg) - consumed), amt: tax.taxable_amount, cgst: tax.cgst, sgst: tax.sgst,
    igst: input.igst_manual != null ? round2(input.igst_manual) : tax.igst, tcs: tax.tcs, ro: tax.roundoff,
    tot: tax.total, pst: input.payment_status ?? existing.payment_status, pd: input.payment_date ?? existing.payment_date,
    fy: fy.label, seq: parsePurchaseSeq(input.our_code)
  })
  return getPurchase(db, id)!
}

export function deletePurchase(db: Database.Database, id: number): void {
  const used = db.prepare('SELECT COUNT(*) AS c FROM sale_allocations WHERE purchase_id = ?').get(id) as { c: number }
  if (used.c > 0) throw new Error('Cannot delete: this lot is used by one or more sales. Delete those sales first.')
  db.prepare('DELETE FROM stock_adjustments WHERE purchase_id = ?').run(id)
  db.prepare('DELETE FROM purchases WHERE id = ?').run(id)
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/purchase.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/purchase.ts tests/core/purchase.test.ts
git commit -m "feat: purchase code numbering + purchase CRUD with tax"
```

---

### Task 7: Sales invoice number parse / format / next

**Files:**
- Create: `src/main/core/invoice-number.ts`
- Test: `tests/core/invoice-number.test.ts`

**Interfaces:**
- Produces:
  - `formatInvoiceNumber(prefix: string, seq: number, fyLabel: string): string` → `RP/008/2024-25` (seq padded to 3).
  - `parseInvoiceNumber(s: string): { prefix: string; seq: number; fyLabel: string } | null`.
  - `nextInvoiceNumber(db, date: string, prefix: string): string` — max `seq` among sales in that FY + 1.

- [ ] **Step 1: Write the failing test**

`tests/core/invoice-number.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { formatInvoiceNumber, parseInvoiceNumber, nextInvoiceNumber } from '../../src/main/core/invoice-number'

describe('format/parse', () => {
  it('formats with 3-digit sequence', () => {
    expect(formatInvoiceNumber('RP', 8, '2024-25')).toBe('RP/008/2024-25')
  })
  it('round-trips a parse', () => {
    expect(parseInvoiceNumber('RP/008/2024-25')).toEqual({ prefix: 'RP', seq: 8, fyLabel: '2024-25' })
  })
  it('returns null on garbage', () => {
    expect(parseInvoiceNumber('nope')).toBeNull()
  })
})

describe('nextInvoiceNumber', () => {
  let db: ReturnType<typeof openDatabase>
  beforeEach(() => { db = openDatabase(':memory:') })
  it('starts at 001 for an empty FY', () => {
    expect(nextInvoiceNumber(db, '2024-05-01', 'RP')).toBe('RP/001/2024-25')
  })
  it('continues past existing rows in the FY', () => {
    db.prepare("INSERT INTO sales (invoice_number, prefix, seq, fy_label, status) VALUES ('RP/004/2024-25','RP',4,'2024-25','created')").run()
    expect(nextInvoiceNumber(db, '2024-06-01', 'RP')).toBe('RP/005/2024-25')
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/invoice-number.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/invoice-number.ts`:
```ts
import type Database from 'better-sqlite3'
import { financialYear } from './financial-year'

export function formatInvoiceNumber(prefix: string, seq: number, fyLabel: string): string {
  return `${prefix}/${String(seq).padStart(3, '0')}/${fyLabel}`
}

export function parseInvoiceNumber(s: string): { prefix: string; seq: number; fyLabel: string } | null {
  const m = s.trim().match(/^(.+?)\/(\d+)\/(\d{4}-\d{2})$/)
  if (!m) return null
  return { prefix: m[1], seq: Number(m[2]), fyLabel: m[3] }
}

export function nextInvoiceNumber(db: Database.Database, date: string, prefix: string): string {
  const fy = financialYear(date)
  const row = db.prepare('SELECT MAX(seq) AS m FROM sales WHERE fy_label = ?').get(fy.label) as { m: number | null }
  return formatInvoiceNumber(prefix, (row.m ?? 0) + 1, fy.label)
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/invoice-number.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/invoice-number.ts tests/core/invoice-number.test.ts
git commit -m "feat: sales invoice number parse/format/next"
```

---

### Task 8: Gap reservation + monotonic date↔number validation

**Files:**
- Create: `src/main/core/invoice-validation.ts`
- Test: `tests/core/invoice-validation.test.ts`

**Interfaces:**
- Consumes: `parseInvoiceNumber`.
- Produces:
  - `reserveGaps(db, prefix: string, fyLabel: string, fromSeqExclusive: number, toSeqExclusive: number): void` — inserts `status='reserved'` rows for every missing seq strictly between the two bounds (used when a user jumps ahead, e.g. creates `RP/011` while `009`/`010` don't exist).
  - `validateInvoiceOrder(db, opts: { fyLabel: string; seq: number; invoiceDate: string; excludeSaleId?: number }): { ok: boolean; message?: string }` — invoice date must be `>=` the date of the nearest earlier-numbered *created* bill and `<=` the date of the nearest later-numbered *created* bill in the same FY. Reserved (blank-date) rows are skipped.

- [ ] **Step 1: Write the failing test**

`tests/core/invoice-validation.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { reserveGaps, validateInvoiceOrder } from '../../src/main/core/invoice-validation'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

function created(seq: number, date: string) {
  db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
    VALUES (?, 'RP', ?, '2024-25', 'created', ?)`).run(`RP/${String(seq).padStart(3,'0')}/2024-25`, seq, date)
}

describe('reserveGaps', () => {
  it('creates blank reserved rows for skipped numbers', () => {
    reserveGaps(db, 'RP', '2024-25', 8, 11)   // reserve 9 and 10
    const rows = db.prepare("SELECT seq, status, invoice_date FROM sales WHERE fy_label='2024-25' ORDER BY seq").all() as any[]
    expect(rows.map(r => r.seq)).toEqual([9, 10])
    expect(rows.every(r => r.status === 'reserved' && r.invoice_date === null)).toBe(true)
  })
})

describe('validateInvoiceOrder', () => {
  beforeEach(() => { created(5, '2024-05-10'); created(7, '2024-05-20') })
  it('accepts a date inside the window for seq 6', () => {
    expect(validateInvoiceOrder(db, { fyLabel: '2024-25', seq: 6, invoiceDate: '2024-05-15' }).ok).toBe(true)
  })
  it('rejects a date before the earlier-numbered bill', () => {
    const r = validateInvoiceOrder(db, { fyLabel: '2024-25', seq: 6, invoiceDate: '2024-05-09' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('on or after')
  })
  it('rejects a date after the later-numbered bill', () => {
    const r = validateInvoiceOrder(db, { fyLabel: '2024-25', seq: 6, invoiceDate: '2024-05-21' })
    expect(r.ok).toBe(false)
    expect(r.message).toContain('on or before')
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/invoice-validation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/invoice-validation.ts`:
```ts
import type Database from 'better-sqlite3'
import { formatInvoiceNumber } from './invoice-number'

export function reserveGaps(db: Database.Database, prefix: string, fyLabel: string, fromSeqExclusive: number, toSeqExclusive: number): void {
  const insert = db.prepare(`INSERT OR IGNORE INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
    VALUES (?, ?, ?, ?, 'reserved', NULL)`)
  const tx = db.transaction(() => {
    for (let s = fromSeqExclusive + 1; s < toSeqExclusive; s++)
      insert.run(formatInvoiceNumber(prefix, s, fyLabel), prefix, s, fyLabel)
  })
  tx()
}

export function validateInvoiceOrder(
  db: Database.Database,
  opts: { fyLabel: string; seq: number; invoiceDate: string; excludeSaleId?: number }
): { ok: boolean; message?: string } {
  const exclude = opts.excludeSaleId ?? -1
  const prev = db.prepare(`SELECT invoice_date FROM sales
    WHERE fy_label = ? AND status = 'created' AND seq < ? AND invoice_date IS NOT NULL AND id <> ?
    ORDER BY seq DESC LIMIT 1`).get(opts.fyLabel, opts.seq, exclude) as { invoice_date: string } | undefined
  const next = db.prepare(`SELECT invoice_date FROM sales
    WHERE fy_label = ? AND status = 'created' AND seq > ? AND invoice_date IS NOT NULL AND id <> ?
    ORDER BY seq ASC LIMIT 1`).get(opts.fyLabel, opts.seq, exclude) as { invoice_date: string } | undefined

  if (prev && opts.invoiceDate < prev.invoice_date)
    return { ok: false, message: `Date must be on or after ${prev.invoice_date} to keep invoice order valid` }
  if (next && opts.invoiceDate > next.invoice_date)
    return { ok: false, message: `Date must be on or before ${next.invoice_date} to keep invoice order valid` }
  return { ok: true }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/invoice-validation.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/invoice-validation.ts tests/core/invoice-validation.test.ts
git commit -m "feat: gap reservation + monotonic date<->number validation"
```

---

### Task 9: Available-lots (date-aware, as-of remaining)

**Files:**
- Create: `src/main/core/available-lots.ts`
- Test: `tests/core/available-lots.test.ts`

**Interfaces:**
- Consumes: `round2`.
- Produces: `listAvailableLots(db, asOfDate: string, opts?: { excludeSaleId?: number }): AvailableLot[]`. Returns only purchases with `invoice_date <= asOfDate`, each with `available_kg = qty_kg − (allocations dated ≤ asOfDate) − (adjustments dated ≤ asOfDate)`. Allocation date = its sale's `invoice_date`. `excludeSaleId` ignores a sale's own allocations (so editing a backdated sale sees its own stock as available). Only rows with `available_kg > 0` are returned, sorted oldest-first (FIFO hint).

- [ ] **Step 1: Write the failing test**

`tests/core/available-lots.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase } from '../../src/main/core/purchase'
import { listAvailableLots } from '../../src/main/core/available-lots'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const base = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }

function sale(date: string, purchaseId: number, qty: number) {
  const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date)
    VALUES ('RP/x', 'RP', 1, '2024-25', 'created', ?)`).run(date)
  db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, qty_drawn_kg, rate_per_kg, line_amount)
    VALUES (?, ?, ?, 1, ?)`).run(info.lastInsertRowid, purchaseId, qty, qty)
}

describe('listAvailableLots', () => {
  it('excludes lots purchased after the as-of date', () => {
    createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-06-01', qty_kg: 500 })
    expect(listAvailableLots(db, '2024-05-01')).toHaveLength(0)
    expect(listAvailableLots(db, '2024-06-01')).toHaveLength(1)
  })
  it('subtracts only sales dated on or before the as-of date', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    sale('2024-07-01', p.id, 400)            // future relative to as-of
    expect(listAvailableLots(db, '2024-06-01')[0].available_kg).toBe(1000)
    expect(listAvailableLots(db, '2024-08-01')[0].available_kg).toBe(600)
  })
  it('drops lots with zero available', () => {
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 100 })
    sale('2024-05-02', p.id, 100)
    expect(listAvailableLots(db, '2024-06-01')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/available-lots.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/available-lots.ts`:
```ts
import type Database from 'better-sqlite3'
import type { AvailableLot } from '@shared/types'
import { round2 } from './money'

export function listAvailableLots(
  db: Database.Database, asOfDate: string, opts?: { excludeSaleId?: number }
): AvailableLot[] {
  const exclude = opts?.excludeSaleId ?? -1
  const rows = db.prepare(`
    SELECT p.id AS purchase_id, p.our_code, p.party, p.hsn_code, p.invoice_date, p.qty_kg,
      COALESCE((SELECT SUM(a.qty_drawn_kg) FROM sale_allocations a
                JOIN sales s ON s.id = a.sale_id
                WHERE a.purchase_id = p.id AND s.invoice_date IS NOT NULL
                  AND s.invoice_date <= @d AND s.id <> @ex), 0) AS sold,
      COALESCE((SELECT SUM(adj.qty_kg) FROM stock_adjustments adj
                WHERE adj.purchase_id = p.id AND adj.date <= @d), 0) AS adjusted
    FROM purchases p
    WHERE p.invoice_date <= @d
    ORDER BY p.invoice_date ASC, p.id ASC
  `).all({ d: asOfDate, ex: exclude }) as Array<AvailableLot & { qty_kg: number; sold: number; adjusted: number }>

  return rows
    .map(r => ({
      purchase_id: r.purchase_id, our_code: r.our_code, party: r.party,
      hsn_code: r.hsn_code, invoice_date: r.invoice_date,
      available_kg: round2(r.qty_kg - r.sold - r.adjusted)
    }))
    .filter(r => r.available_kg > 0)
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/available-lots.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/available-lots.ts tests/core/available-lots.test.ts
git commit -m "feat: date-aware available-lots query (as-of remaining)"
```

---

### Task 10: Atomic sale creation + stock draw-down

**Files:**
- Create: `src/main/core/sale.ts`
- Test: `tests/core/sale.test.ts`

**Interfaces:**
- Consumes: `computeTax`, `round2`, `financialYear`, `parseInvoiceNumber`, `formatInvoiceNumber`, `reserveGaps`, `validateInvoiceOrder`, `listAvailableLots`.
- Produces:
  - `createSale(db, input: NewSale): Sale` — runs in ONE transaction: validates order, reserves gaps if the chosen seq jumps ahead, checks each allocation against as-of available qty, computes tax on summed line amounts, inserts the sale (status `created`) — reusing a reserved row if one exists for that seq — inserts allocations, and decrements each lot's `qty_remaining_kg`. Throws (rolling back everything) on over-draw or order violation.
  - `fillReservedSale(db, saleId, input)` — same logic, targeting an existing reserved row's seq.
  - `listSales(db): Sale[]`, `getSale(db, id): Sale`, `getAllocations(db, saleId): SaleAllocation[]`, `deleteSale(db, id)` (restores `qty_remaining_kg`, then deletes; allocations cascade).
  ```ts
  interface NewSaleLine { purchase_id: number; qty_drawn_kg: number; rate_per_kg: number }
  interface NewSale {
    invoice_number: string; invoice_date: string;
    buyer_customer_id: number | null; buyer_name: string; buyer_gstin: string;
    buyer_billing: object; buyer_shipping: object; place_of_supply_state: string;
    homeState: string; hsn_code: string; gst_rate: number;
    lines: NewSaleLine[]; tcs?: number; roundoff?: number;
    eway_bill_no?: string; eway_bill_date?: string; vehicle?: string;
    payment_status?: 'pending' | 'done'; payment_date?: string | null;
  }
  ```

- [ ] **Step 1: Write the failing test**

`tests/core/sale.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { createSale, listSales, deleteSale } from '../../src/main/core/sale'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const pbase = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }
function lot(code: string, date: string, qty: number) {
  return createPurchase(db, { ...pbase, our_code: code, invoice_date: date, qty_kg: qty })
}
const sbase = {
  buyer_customer_id: null, buyer_name: 'Buyer', buyer_gstin: '',
  buyer_billing: {}, buyer_shipping: {}, place_of_supply_state: 'Gujarat',
  homeState: 'Gujarat', hsn_code: '3902', gst_rate: 18
}

describe('createSale', () => {
  it('draws across two lots and decrements remaining', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const b = lot('0002/2425', '2024-05-02', 1000)
    const sale = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 600, rate_per_kg: 80 }, { purchase_id: b.id, qty_drawn_kg: 400, rate_per_kg: 90 }] })
    expect(sale.total_qty_kg).toBe(1000)
    expect(sale.amount).toBe(84000)         // 600*80 + 400*90
    expect(sale.cgst).toBe(7560)            // 9% of 84000
    expect(getPurchase(db, a.id)!.qty_remaining_kg).toBe(400)
    expect(getPurchase(db, b.id)!.qty_remaining_kg).toBe(600)
  })

  it('rejects an over-draw and rolls back everything', () => {
    const a = lot('0001/2425', '2024-05-01', 500)
    expect(() => createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 600, rate_per_kg: 80 }] })).toThrow(/only has 500/)
    expect(getPurchase(db, a.id)!.qty_remaining_kg).toBe(500)
    expect(listSales(db)).toHaveLength(0)
  })

  it('reserves skipped numbers when the seq jumps ahead', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    createSale(db, { ...sbase, invoice_number: 'RP/003/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 100, rate_per_kg: 80 }] })
    const rows = listSales(db)
    expect(rows.find(s => s.seq === 1)!.status).toBe('reserved')
    expect(rows.find(s => s.seq === 2)!.status).toBe('reserved')
    expect(rows.find(s => s.seq === 3)!.status).toBe('created')
  })

  it('deleting a sale restores remaining stock', () => {
    const a = lot('0001/2425', '2024-05-01', 1000)
    const sale = createSale(db, { ...sbase, invoice_number: 'RP/001/2024-25', invoice_date: '2024-05-10',
      lines: [{ purchase_id: a.id, qty_drawn_kg: 300, rate_per_kg: 80 }] })
    deleteSale(db, sale.id)
    expect(getPurchase(db, a.id)!.qty_remaining_kg).toBe(1000)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/sale.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/sale.ts`:
```ts
import type Database from 'better-sqlite3'
import type { Sale, SaleAllocation } from '@shared/types'
import { computeTax } from './tax'
import { round2 } from './money'
import { parseInvoiceNumber } from './invoice-number'
import { reserveGaps, validateInvoiceOrder } from './invoice-validation'
import { listAvailableLots } from './available-lots'

export interface NewSaleLine { purchase_id: number; qty_drawn_kg: number; rate_per_kg: number }
export interface NewSale {
  invoice_number: string; invoice_date: string
  buyer_customer_id: number | null; buyer_name: string; buyer_gstin: string
  buyer_billing: object; buyer_shipping: object; place_of_supply_state: string
  homeState: string; hsn_code: string; gst_rate: number
  lines: NewSaleLine[]; tcs?: number; roundoff?: number
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

  // verify availability as of the invoice date (exclude this sale's own prior allocations when re-filling)
  const avail = new Map(listAvailableLots(db, input.invoice_date, { excludeSaleId: existingReservedId ?? undefined })
    .map(l => [l.purchase_id, l]))
  let amount = 0, totalQty = 0
  for (const line of input.lines) {
    const lot = avail.get(line.purchase_id)
    const have = lot?.available_kg ?? 0
    if (round2(line.qty_drawn_kg) > have)
      throw new Error(`Lot ${lot?.our_code ?? line.purchase_id} only has ${have} kg left as of ${input.invoice_date}`)
    amount = round2(amount + round2(line.qty_drawn_kg * line.rate_per_kg))
    totalQty = round2(totalQty + line.qty_drawn_kg)
  }

  const tax = computeTax({ amount, gstRate: input.gst_rate,
    placeOfSupplyState: input.place_of_supply_state, homeState: input.homeState,
    tcs: input.tcs, roundoff: input.roundoff })

  // reserve any gap below this seq
  const maxBelow = db.prepare('SELECT MAX(seq) AS m FROM sales WHERE fy_label = ? AND seq < ?').get(fyLabel, seq) as { m: number | null }
  reserveGaps(db, prefix, fyLabel, maxBelow.m ?? 0, seq)

  const fields = {
    invoice_number: input.invoice_number, prefix, seq, fy_label: fyLabel, status: 'created',
    invoice_date: input.invoice_date, eway_bill_no: input.eway_bill_no ?? null,
    eway_bill_date: input.eway_bill_date ?? null, vehicle: input.vehicle ?? null,
    buyer_customer_id: input.buyer_customer_id, buyer_name: input.buyer_name, buyer_gstin: input.buyer_gstin,
    buyer_billing_json: JSON.stringify(input.buyer_billing), buyer_shipping_json: JSON.stringify(input.buyer_shipping),
    hsn_code: input.hsn_code, amount: tax.taxable_amount, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst,
    tcs: tax.tcs, roundoff: tax.roundoff, total_invoice_amount: tax.total, total_qty_kg: totalQty,
    payment_status: input.payment_status ?? 'pending', payment_date: input.payment_date ?? null
  }

  let saleId: number
  if (existingReservedId != null) {
    db.prepare(`UPDATE sales SET invoice_number=@invoice_number, prefix=@prefix, seq=@seq, fy_label=@fy_label,
      status=@status, invoice_date=@invoice_date, eway_bill_no=@eway_bill_no, eway_bill_date=@eway_bill_date,
      vehicle=@vehicle, buyer_customer_id=@buyer_customer_id, buyer_name=@buyer_name, buyer_gstin=@buyer_gstin,
      buyer_billing_json=@buyer_billing_json, buyer_shipping_json=@buyer_shipping_json, hsn_code=@hsn_code,
      amount=@amount, cgst=@cgst, sgst=@sgst, igst=@igst, tcs=@tcs, roundoff=@roundoff,
      total_invoice_amount=@total_invoice_amount, total_qty_kg=@total_qty_kg, payment_status=@payment_status,
      payment_date=@payment_date WHERE id=@id`).run({ ...fields, id: existingReservedId })
    saleId = existingReservedId
    db.prepare('DELETE FROM sale_allocations WHERE sale_id = ?').run(saleId)
  } else {
    const info = db.prepare(`INSERT INTO sales (invoice_number, prefix, seq, fy_label, status, invoice_date,
      eway_bill_no, eway_bill_date, vehicle, buyer_customer_id, buyer_name, buyer_gstin, buyer_billing_json,
      buyer_shipping_json, hsn_code, amount, cgst, sgst, igst, tcs, roundoff, total_invoice_amount,
      total_qty_kg, payment_status, payment_date)
      VALUES (@invoice_number, @prefix, @seq, @fy_label, @status, @invoice_date, @eway_bill_no, @eway_bill_date,
      @vehicle, @buyer_customer_id, @buyer_name, @buyer_gstin, @buyer_billing_json, @buyer_shipping_json,
      @hsn_code, @amount, @cgst, @sgst, @igst, @tcs, @roundoff, @total_invoice_amount, @total_qty_kg,
      @payment_status, @payment_date)`).run(fields)
    saleId = Number(info.lastInsertRowid)
  }

  const insAlloc = db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, qty_drawn_kg, rate_per_kg, line_amount)
    VALUES (?, ?, ?, ?, ?)`)
  const dec = db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg - ?, 2) WHERE id = ?')
  for (const line of input.lines) {
    insAlloc.run(saleId, line.purchase_id, round2(line.qty_drawn_kg), round2(line.rate_per_kg), round2(line.qty_drawn_kg * line.rate_per_kg))
    dec.run(round2(line.qty_drawn_kg), line.purchase_id)
  }
  return getSale(db, saleId)
}

export function createSale(db: Database.Database, input: NewSale): Sale {
  const parsed = parseInvoiceNumber(input.invoice_number)
  const reserved = parsed
    ? db.prepare(`SELECT id FROM sales WHERE fy_label = ? AND seq = ? AND status = 'reserved'`).get(parsed.fyLabel, parsed.seq) as { id: number } | undefined
    : undefined
  const tx = db.transaction(() => writeSale(db, input, reserved?.id ?? null))
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
    db.prepare('DELETE FROM sales WHERE id = ?').run(id)   // allocations cascade
  })
  tx()
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/sale.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/sale.ts tests/core/sale.test.ts
git commit -m "feat: atomic sale creation, stock draw-down, gap reservation, delete-restore"
```

---

### Task 11: Stock adjustments + derived stock ledger

**Files:**
- Create: `src/main/core/adjustment.ts`
- Test: `tests/core/adjustment.test.ts`

**Interfaces:**
- Consumes: `round2`.
- Produces:
  - `createStockAdjustment(db, input: { purchase_id: number; qty_kg: number; reason: string; date: string }): void` — one transaction: insert the adjustment and decrement that lot's `qty_remaining_kg`; throws if `qty_kg` exceeds current remaining.
  - `stockLedger(db): LedgerRow[]` — every purchase with `qty_remaining_kg > 0`, `consumed_kg = qty_kg − qty_remaining_kg`, `balance_kg = qty_remaining_kg`, grouped by HSN then date (sorted by `hsn_code`, `invoice_date`).

- [ ] **Step 1: Write the failing test**

`tests/core/adjustment.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { createStockAdjustment, stockLedger } from '../../src/main/core/adjustment'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })
const pbase = { supplier_invoice_number: 'S', party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', amount: 1000, gst_rate: 18, homeState: 'Gujarat' }

describe('createStockAdjustment', () => {
  it('reduces remaining by the adjusted amount', () => {
    const p = createPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_id: p.id, qty_kg: 50, reason: 'spillage', date: '2024-05-05' })
    expect(getPurchase(db, p.id)!.qty_remaining_kg).toBe(950)
  })
  it('rejects an adjustment larger than remaining', () => {
    const p = createPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 100 })
    expect(() => createStockAdjustment(db, { purchase_id: p.id, qty_kg: 150, reason: 'x', date: '2024-05-05' })).toThrow(/only has 100/)
    expect(getPurchase(db, p.id)!.qty_remaining_kg).toBe(100)
  })
})

describe('stockLedger', () => {
  it('lists lots with positive balance', () => {
    const p = createPurchase(db, { ...pbase, our_code: '0001/2425', invoice_date: '2024-05-01', qty_kg: 1000 })
    createStockAdjustment(db, { purchase_id: p.id, qty_kg: 200, reason: 'sample', date: '2024-05-05' })
    const ledger = stockLedger(db)
    expect(ledger).toHaveLength(1)
    expect(ledger[0]).toMatchObject({ consumed_kg: 200, balance_kg: 800 })
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/adjustment.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/adjustment.ts`:
```ts
import type Database from 'better-sqlite3'
import type { LedgerRow } from '@shared/types'
import { round2 } from './money'

export function createStockAdjustment(
  db: Database.Database,
  input: { purchase_id: number; qty_kg: number; reason: string; date: string }
): void {
  const tx = db.transaction(() => {
    const lot = db.prepare('SELECT qty_remaining_kg FROM purchases WHERE id = ?').get(input.purchase_id) as { qty_remaining_kg: number } | undefined
    if (!lot) throw new Error('Lot not found')
    if (round2(input.qty_kg) > lot.qty_remaining_kg)
      throw new Error(`This lot only has ${lot.qty_remaining_kg} kg left`)
    db.prepare('INSERT INTO stock_adjustments (purchase_id, qty_kg, reason, date) VALUES (?, ?, ?, ?)')
      .run(input.purchase_id, round2(input.qty_kg), input.reason, input.date)
    db.prepare('UPDATE purchases SET qty_remaining_kg = round(qty_remaining_kg - ?, 2) WHERE id = ?')
      .run(round2(input.qty_kg), input.purchase_id)
  })
  tx()
}

export function stockLedger(db: Database.Database): LedgerRow[] {
  return db.prepare(`
    SELECT id AS purchase_id, our_code, hsn_code, party, invoice_date,
      qty_kg, round(qty_kg - qty_remaining_kg, 2) AS consumed_kg, qty_remaining_kg AS balance_kg
    FROM purchases WHERE qty_remaining_kg > 0
    ORDER BY hsn_code ASC, invoice_date ASC, id ASC
  `).all() as LedgerRow[]
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/adjustment.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/adjustment.ts tests/core/adjustment.test.ts
git commit -m "feat: stock adjustments + derived stock ledger"
```

---

### Task 12: Customers CRUD + HSN/settings reference store

**Files:**
- Create: `src/main/core/customers.ts`, `src/main/core/reference.ts`
- Test: `tests/core/customers.test.ts`, `tests/core/reference.test.ts`

**Interfaces:**
- Produces (`customers.ts`):
  - `createCustomer(db, c: Omit<Customer,'id'>): Customer`, `updateCustomer(db, id, c): Customer`, `listCustomers(db, search?: string): Customer[]`, `getCustomer(db, id): Customer | undefined`, `deleteCustomer(db, id): void`.
  - `placeOfSupplyState(c: Customer): string` — `shipping_same ? billing_state : (shipping_state || billing_state)`.
- Produces (`reference.ts`):
  - `getSettings(db): Settings` (with defaults), `saveSettings(db, partial: Partial<Settings>): Settings`.
  - `listHsn(db): HsnProduct[]`, `upsertHsn(db, h: HsnProduct): void`, `getHsnRate(db, code: string, fallback: number): number`.
  - `DEFAULT_SETTINGS: Settings`.

- [ ] **Step 1: Write the failing tests**

`tests/core/customers.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createCustomer, listCustomers, placeOfSupplyState } from '../../src/main/core/customers'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })
const c = {
  name: 'Beta Traders', gstin: '24XXX', pan: 'AAA', phone: '999',
  billing_address: 'A', billing_city: 'Surat', billing_state: 'Gujarat', billing_pincode: '395003',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

describe('customers', () => {
  it('creates and searches by name', () => {
    createCustomer(db, c)
    expect(listCustomers(db, 'beta')).toHaveLength(1)
    expect(listCustomers(db, 'zzz')).toHaveLength(0)
  })
  it('place of supply falls back to billing when shipping is same', () => {
    const saved = createCustomer(db, c)
    expect(placeOfSupplyState(saved)).toBe('Gujarat')
  })
  it('place of supply uses shipping state when different', () => {
    const saved = createCustomer(db, { ...c, shipping_same: false, shipping_state: 'Maharashtra' })
    expect(placeOfSupplyState(saved)).toBe('Maharashtra')
  })
})
```

`tests/core/reference.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { getSettings, saveSettings, upsertHsn, getHsnRate } from '../../src/main/core/reference'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

describe('settings', () => {
  it('returns defaults then persists overrides', () => {
    expect(getSettings(db).default_gst_rate).toBe(18)
    saveSettings(db, { home_state: 'Gujarat', invoice_prefix: 'RP' })
    expect(getSettings(db).home_state).toBe('Gujarat')
    expect(getSettings(db).invoice_prefix).toBe('RP')
  })
})

describe('hsn', () => {
  it('upserts and reads a rate with fallback', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    expect(getHsnRate(db, '3902', 18)).toBe(5)
    expect(getHsnRate(db, '9999', 18)).toBe(18)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/core/customers.test.ts tests/core/reference.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement customers**

`src/main/core/customers.ts`:
```ts
import type Database from 'better-sqlite3'
import type { Customer } from '@shared/types'

const COLS = `name, gstin, pan, phone, billing_address, billing_city, billing_state, billing_pincode,
  shipping_same, shipping_address, shipping_city, shipping_state, shipping_pincode`

function rowToCustomer(r: any): Customer { return { ...r, shipping_same: !!r.shipping_same } }

export function createCustomer(db: Database.Database, c: Omit<Customer, 'id'>): Customer {
  const info = db.prepare(`INSERT INTO customers (${COLS}) VALUES
    (@name,@gstin,@pan,@phone,@billing_address,@billing_city,@billing_state,@billing_pincode,
     @shipping_same,@shipping_address,@shipping_city,@shipping_state,@shipping_pincode)`)
    .run({ ...c, shipping_same: c.shipping_same ? 1 : 0 })
  return getCustomer(db, Number(info.lastInsertRowid))!
}

export function updateCustomer(db: Database.Database, id: number, c: Omit<Customer, 'id'>): Customer {
  db.prepare(`UPDATE customers SET name=@name, gstin=@gstin, pan=@pan, phone=@phone,
    billing_address=@billing_address, billing_city=@billing_city, billing_state=@billing_state,
    billing_pincode=@billing_pincode, shipping_same=@shipping_same, shipping_address=@shipping_address,
    shipping_city=@shipping_city, shipping_state=@shipping_state, shipping_pincode=@shipping_pincode
    WHERE id=@id`).run({ ...c, id, shipping_same: c.shipping_same ? 1 : 0 })
  return getCustomer(db, id)!
}

export function getCustomer(db: Database.Database, id: number): Customer | undefined {
  const r = db.prepare('SELECT * FROM customers WHERE id = ?').get(id)
  return r ? rowToCustomer(r) : undefined
}

export function listCustomers(db: Database.Database, search?: string): Customer[] {
  const rows = search
    ? db.prepare(`SELECT * FROM customers WHERE name LIKE ? OR gstin LIKE ? ORDER BY name`).all(`%${search}%`, `%${search}%`)
    : db.prepare('SELECT * FROM customers ORDER BY name').all()
  return (rows as any[]).map(rowToCustomer)
}

export function deleteCustomer(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM customers WHERE id = ?').run(id)
}

export function placeOfSupplyState(c: Customer): string {
  return c.shipping_same ? c.billing_state : (c.shipping_state || c.billing_state)
}
```

- [ ] **Step 4: Implement reference**

`src/main/core/reference.ts`:
```ts
import type Database from 'better-sqlite3'
import type { Settings, HsnProduct } from '@shared/types'

export const DEFAULT_SETTINGS: Settings = {
  seller_name: '', seller_address: '', seller_gstin: '', seller_pan: '', home_state: '',
  invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10
}

export function getSettings(db: Database.Database): Settings {
  const rows = db.prepare('SELECT key, value FROM settings').all() as Array<{ key: string; value: string }>
  const map = new Map(rows.map(r => [r.key, r.value]))
  const result = { ...DEFAULT_SETTINGS } as any
  for (const key of Object.keys(DEFAULT_SETTINGS) as Array<keyof Settings>) {
    if (!map.has(key)) continue
    const raw = map.get(key)!
    result[key] = typeof DEFAULT_SETTINGS[key] === 'number' ? Number(raw) : raw
  }
  return result
}

export function saveSettings(db: Database.Database, partial: Partial<Settings>): Settings {
  const up = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
  const tx = db.transaction(() => { for (const [k, v] of Object.entries(partial)) up.run(k, String(v)) })
  tx()
  return getSettings(db)
}

export function listHsn(db: Database.Database): HsnProduct[] {
  return db.prepare('SELECT * FROM hsn_products ORDER BY hsn_code').all() as HsnProduct[]
}

export function upsertHsn(db: Database.Database, h: HsnProduct): void {
  db.prepare(`INSERT INTO hsn_products (hsn_code, description, gst_rate) VALUES (?, ?, ?)
    ON CONFLICT(hsn_code) DO UPDATE SET description = excluded.description, gst_rate = excluded.gst_rate`)
    .run(h.hsn_code, h.description, h.gst_rate)
}

export function getHsnRate(db: Database.Database, code: string, fallback: number): number {
  const r = db.prepare('SELECT gst_rate FROM hsn_products WHERE hsn_code = ?').get(code) as { gst_rate: number } | undefined
  return r ? r.gst_rate : fallback
}
```

- [ ] **Step 5: Run tests, verify they pass**

Run: `npx vitest run tests/core/customers.test.ts tests/core/reference.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Commit**

```bash
git add src/main/core/customers.ts src/main/core/reference.ts tests/core/customers.test.ts tests/core/reference.test.ts
git commit -m "feat: customers CRUD + HSN/settings reference store"
```

---

### Task 13: Backups + lock file

**Files:**
- Create: `src/main/core/backup.ts`
- Test: `tests/core/backup.test.ts`

**Interfaces:**
- Consumes: Node `fs`, `path`.
- Produces:
  - `createBackup(dbPath: string, backupDir: string, keepCount: number): string` — copies the db file to `backupDir/<dbname>.<timestamp>.db`, prunes oldest beyond `keepCount`, returns the new path. Caller supplies the timestamp string to keep it testable: signature is `createBackup(dbPath, backupDir, keepCount, stamp: string)`.
  - `acquireLock(dir: string, holder: string): { ok: boolean; existingHolder?: string }` — writes `dir/.granule.lock` with `holder` + timestamp; if a lock exists, returns `{ ok: false, existingHolder }` without overwriting.
  - `releaseLock(dir: string): void` — removes the lock file if present.

- [ ] **Step 1: Write the failing test**

`tests/core/backup.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createBackup, acquireLock, releaseLock } from '../../src/main/core/backup'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'gt-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('createBackup', () => {
  it('copies the db and prunes beyond keepCount', () => {
    const dbPath = join(dir, 'data.db')
    writeFileSync(dbPath, 'x')
    const backupDir = join(dir, 'backups')
    for (const t of ['001', '002', '003']) createBackup(dbPath, backupDir, 2, t)
    const files = readdirSync(backupDir).sort()
    expect(files).toEqual(['data.002.db', 'data.003.db'])
  })
})

describe('lock', () => {
  it('acquires, blocks a second holder, then releases', () => {
    expect(acquireLock(dir, 'MacA').ok).toBe(true)
    const second = acquireLock(dir, 'MacB')
    expect(second.ok).toBe(false)
    expect(second.existingHolder).toContain('MacA')
    releaseLock(dir)
    expect(existsSync(join(dir, '.granule.lock'))).toBe(false)
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/core/backup.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/main/core/backup.ts`:
```ts
import { copyFileSync, mkdirSync, readdirSync, unlinkSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join, basename, extname } from 'path'

const LOCK = '.granule.lock'

export function createBackup(dbPath: string, backupDir: string, keepCount: number, stamp: string): string {
  mkdirSync(backupDir, { recursive: true })
  const name = basename(dbPath, extname(dbPath))
  const dest = join(backupDir, `${name}.${stamp}.db`)
  copyFileSync(dbPath, dest)
  const prefix = `${name}.`
  const backups = readdirSync(backupDir).filter(f => f.startsWith(prefix) && f.endsWith('.db')).sort()
  for (const old of backups.slice(0, Math.max(0, backups.length - keepCount)))
    unlinkSync(join(backupDir, old))
  return dest
}

export function acquireLock(dir: string, holder: string): { ok: boolean; existingHolder?: string } {
  const path = join(dir, LOCK)
  if (existsSync(path)) return { ok: false, existingHolder: readFileSync(path, 'utf8') }
  writeFileSync(path, `${holder} @ lock`)
  return { ok: true }
}

export function releaseLock(dir: string): void {
  const path = join(dir, LOCK)
  if (existsSync(path)) unlinkSync(path)
}
```

> The bootstrap (Task 14) passes a real timestamp via `new Date().toISOString().replace(/[:.]/g,'-')` and the machine name via `os.hostname()`.

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/core/backup.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run the full core suite**

Run: `npm test`
Expected: all tests green.

- [ ] **Step 6: Commit**

```bash
git add src/main/core/backup.ts tests/core/backup.test.ts
git commit -m "feat: timestamped backups with pruning + single-machine lock file"
```

---

## Phase 3 — IPC bridge & bootstrap

### Task 14: Typed API contract, preload bridge, IPC handlers, app bootstrap

**Files:**
- Create: `src/shared/api.ts`, `src/main/ipc.ts`
- Modify: `src/preload/index.ts`, `src/main/index.ts`
- Test: `tests/core/api-shape.test.ts` (a guard that every `Api` method name is registered)

**Interfaces:**
- Produces: the `Api` interface (the single contract the renderer programs against) and `window.api` implementing it. Every method returns a `Promise`.
  ```ts
  // src/shared/api.ts — the contract
  import type { Purchase, Customer, Sale, SaleAllocation, HsnProduct, Settings, AvailableLot, LedgerRow } from './types'
  import type { NewPurchase } from '../main/core/purchase'   // type-only import; not bundled into renderer
  import type { NewSale } from '../main/core/sale'
  export interface Api {
    // bootstrap / settings
    needsSetup(): Promise<boolean>
    chooseDataFolder(): Promise<string | null>
    getSettings(): Promise<Settings>
    saveSettings(p: Partial<Settings>): Promise<Settings>
    backupNow(): Promise<string>
    // purchases
    nextPurchaseCode(date: string): Promise<string>
    createPurchase(input: NewPurchase): Promise<Purchase>
    updatePurchase(id: number, input: NewPurchase): Promise<Purchase>
    listPurchases(): Promise<Purchase[]>
    deletePurchase(id: number): Promise<void>
    // sales
    nextInvoiceNumber(date: string, prefix: string): Promise<string>
    listAvailableLots(asOfDate: string, excludeSaleId?: number): Promise<AvailableLot[]>
    createSale(input: NewSale): Promise<Sale>
    fillReservedSale(id: number, input: NewSale): Promise<Sale>
    listSales(): Promise<Sale[]>
    getSaleWithAllocations(id: number): Promise<{ sale: Sale; allocations: SaleAllocation[] }>
    deleteSale(id: number): Promise<void>
    // stock
    stockLedger(): Promise<LedgerRow[]>
    createStockAdjustment(input: { purchase_id: number; qty_kg: number; reason: string; date: string }): Promise<void>
    // customers
    listCustomers(search?: string): Promise<Customer[]>
    createCustomer(c: Omit<Customer, 'id'>): Promise<Customer>
    updateCustomer(id: number, c: Omit<Customer, 'id'>): Promise<Customer>
    deleteCustomer(id: number): Promise<void>
    // hsn
    listHsn(): Promise<HsnProduct[]>
    upsertHsn(h: HsnProduct): Promise<void>
  }
  declare global { interface Window { api: Api } }
  ```

- [ ] **Step 1: Write the API contract file**

Create `src/shared/api.ts` exactly as in the Interfaces block above, then append the channel list (the single source of truth shared by `ipc.ts`, the preload bridge, and the guard test):
```ts
export const CHANNELS = [
  'needsSetup','chooseDataFolder','getSettings','saveSettings','backupNow',
  'nextPurchaseCode','createPurchase','updatePurchase','listPurchases','deletePurchase',
  'nextInvoiceNumber','listAvailableLots','createSale','fillReservedSale','listSales',
  'getSaleWithAllocations','deleteSale','stockLedger','createStockAdjustment',
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listHsn','upsertHsn'
] as const
```
Keeping `CHANNELS` in `src/shared/api.ts` (not in `ipc.ts`) guarantees the preload bundle never transitively imports `better-sqlite3`.

- [ ] **Step 2: Write the failing guard test**

`tests/core/api-shape.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { CHANNELS } from '../../src/shared/api'

const API_METHODS = [
  'needsSetup','chooseDataFolder','getSettings','saveSettings','backupNow',
  'nextPurchaseCode','createPurchase','updatePurchase','listPurchases','deletePurchase',
  'nextInvoiceNumber','listAvailableLots','createSale','fillReservedSale','listSales',
  'getSaleWithAllocations','deleteSale','stockLedger','createStockAdjustment',
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listHsn','upsertHsn'
]

describe('ipc channels', () => {
  it('registers a channel for every Api method', () => {
    for (const m of API_METHODS) expect(CHANNELS).toContain(m)
  })
})
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run tests/core/api-shape.test.ts`
Expected: FAIL — `src/shared/api` does not yet export `CHANNELS` (add it in Step 1 if not already, then this test passes once `ipc.ts` consumes the same list).

- [ ] **Step 4: Implement IPC handlers**

`src/main/ipc.ts`:
```ts
import { ipcMain, dialog } from 'electron'
import type Database from 'better-sqlite3'
import { getSettings, saveSettings } from './core/reference'
import { nextPurchaseCode, createPurchase, updatePurchase, listPurchases, deletePurchase } from './core/purchase'
import { nextInvoiceNumber } from './core/invoice-number'
import { listAvailableLots } from './core/available-lots'
import { createSale, fillReservedSale, listSales, getSale, getAllocations, deleteSale } from './core/sale'
import { stockLedger, createStockAdjustment } from './core/adjustment'
import { listCustomers, createCustomer, updateCustomer, deleteCustomer } from './core/customers'
import { listHsn, upsertHsn } from './core/reference'
import { createBackup } from './core/backup'
import { join } from 'path'

// CHANNELS lives in src/shared/api.ts (single source of truth, also imported by preload + the guard test).

export interface IpcContext {
  getDb(): Database.Database
  getDbPath(): string
  reopenWithFolder(folder: string): void
}

export function registerIpc(ctx: IpcContext): void {
  const h = (name: string, fn: (...a: any[]) => any) => ipcMain.handle(name, (_e, ...args) => fn(...args))
  const db = () => ctx.getDb()

  h('needsSetup', () => !getSettings(db()).home_state)
  h('chooseDataFolder', async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] })
    if (r.canceled || !r.filePaths[0]) return null
    ctx.reopenWithFolder(r.filePaths[0])
    saveSettings(db(), { data_folder: r.filePaths[0] })
    return r.filePaths[0]
  })
  h('getSettings', () => getSettings(db()))
  h('saveSettings', (p) => saveSettings(db(), p))
  h('backupNow', () => {
    const s = getSettings(db())
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    return createBackup(ctx.getDbPath(), join(s.data_folder, 'backups'), s.backups_to_keep, stamp)
  })

  h('nextPurchaseCode', (date) => nextPurchaseCode(db(), date))
  h('createPurchase', (input) => createPurchase(db(), input))
  h('updatePurchase', (id, input) => updatePurchase(db(), id, input))
  h('listPurchases', () => listPurchases(db()))
  h('deletePurchase', (id) => deletePurchase(db(), id))

  h('nextInvoiceNumber', (date, prefix) => nextInvoiceNumber(db(), date, prefix))
  h('listAvailableLots', (asOfDate, excludeSaleId) => listAvailableLots(db(), asOfDate, { excludeSaleId }))
  h('createSale', (input) => createSale(db(), input))
  h('fillReservedSale', (id, input) => fillReservedSale(db(), id, input))
  h('listSales', () => listSales(db()))
  h('getSaleWithAllocations', (id) => ({ sale: getSale(db(), id), allocations: getAllocations(db(), id) }))
  h('deleteSale', (id) => deleteSale(db(), id))

  h('stockLedger', () => stockLedger(db()))
  h('createStockAdjustment', (input) => createStockAdjustment(db(), input))

  h('listCustomers', (search) => listCustomers(db(), search))
  h('createCustomer', (c) => createCustomer(db(), c))
  h('updateCustomer', (id, c) => updateCustomer(db(), id, c))
  h('deleteCustomer', (id) => deleteCustomer(db(), id))

  h('listHsn', () => listHsn(db()))
  h('upsertHsn', (hh) => upsertHsn(db(), hh))
}
```

- [ ] **Step 5: Implement preload bridge**

`src/preload/index.ts`:
```ts
import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS } from '../shared/api'

const api: Record<string, (...args: any[]) => Promise<any>> = {}
for (const c of CHANNELS) api[c] = (...args: any[]) => ipcRenderer.invoke(c, ...args)
contextBridge.exposeInMainWorld('api', api)
```

> `CHANNELS` is imported from `src/shared/api.ts` (a plain string array with no `better-sqlite3` dependency), so the preload bundle stays free of native modules.

- [ ] **Step 6: Wire bootstrap in main**

`src/main/index.ts` (replace file):
```ts
import { app, BrowserWindow, dialog } from 'electron'
import { join } from 'path'
import { hostname } from 'os'
import type Database from 'better-sqlite3'
import { openDatabase, closeDatabase } from './db/connection'
import { getSettings } from './core/reference'
import { createBackup, acquireLock, releaseLock } from './core/backup'
import { registerIpc } from './ipc'

let db: Database.Database
let dbPath: string
let dataFolder: string

function dbPathFor(folder: string): string { return join(folder, 'granule-trader.db') }

function openIn(folder: string): void {
  if (db) closeDatabase(db)
  dataFolder = folder
  dbPath = dbPathFor(folder)
  db = openDatabase(dbPath)
}

function bootstrapData(): void {
  // First launch with no chosen folder: use userData until the user picks one in Settings/FirstRun.
  openIn(app.getPath('userData'))
  const s = getSettings(db)
  if (s.data_folder && s.data_folder !== dataFolder) openIn(s.data_folder)
  const lock = acquireLock(dataFolder, hostname())
  if (!lock.ok) {
    // Spec §4: warn the user; allow "Open anyway" only if they're sure it's closed elsewhere.
    const choice = dialog.showMessageBoxSync({
      type: 'warning',
      buttons: ['Quit', 'Open anyway'],
      defaultId: 0, cancelId: 0,
      title: 'Data may be open elsewhere',
      message: `This data is currently open on ${lock.existingHolder}.`,
      detail: 'Open anyway only if you are sure it is closed there. Opening it on two machines at once can corrupt the file.'
    })
    if (choice === 0) { app.quit(); return }
    releaseLock(dataFolder); acquireLock(dataFolder, hostname())   // Open anyway: replace the stale lock
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  try { createBackup(dbPath, join(dataFolder, 'backups'), getSettings(db).backups_to_keep, stamp) } catch (e) { console.warn('backup failed', e) }
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { preload: join(__dirname, '../preload/index.js'), sandbox: false }
  })
  win.on('ready-to-show', () => win.show())
  if (process.env['ELECTRON_RENDERER_URL']) win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  else win.loadFile(join(__dirname, '../renderer/index.html'))
}

app.whenReady().then(() => {
  bootstrapData()
  registerIpc({ getDb: () => db, getDbPath: () => dbPath, reopenWithFolder: openIn })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('before-quit', () => { try { releaseLock(dataFolder); if (db) closeDatabase(db) } catch {} })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
```

- [ ] **Step 7: Run test + typecheck**

Run: `npx vitest run tests/core/api-shape.test.ts && npm run typecheck`
Expected: PASS; no type errors.

- [ ] **Step 8: Commit**

```bash
git add src/shared/api.ts src/main/ipc.ts src/preload/index.ts src/main/index.ts tests/core/api-shape.test.ts
git commit -m "feat: typed Api contract, preload bridge, IPC handlers, app bootstrap"
```

---

## Phase 4 — UI (React renderer)

> UI screens call only `window.api.*`. Each screen task ends with a manual verification step (`npm run dev`) because visual layout is best confirmed by eye; logic-bearing pieces (allocation math, the money input) carry unit tests with `@testing-library/react` + jsdom. Set `// @vitest-environment jsdom` at the top of `.test.tsx` files. Mock the API with a `window.api = {...}` stub in those tests.

### Task 15: App shell — theme, router, sidebar, first-run gate

**Files:**
- Create: `src/renderer/theme.css`, `src/renderer/routes.tsx`, `src/renderer/components/Sidebar.tsx`, `src/renderer/screens/FirstRun.tsx`
- Modify: `src/renderer/App.tsx`, `src/renderer/main.tsx`
- Test: `tests/renderer/sidebar.test.tsx`

**Interfaces:**
- Consumes: `window.api.needsSetup`, `window.api.chooseDataFolder`, `window.api.getSettings`, `window.api.saveSettings`.
- Produces: a `HashRouter` app shell with a left sidebar (Dashboard, Purchases, Sales, Stock, Customers, Settings). On launch, if `needsSetup()` is true, render `FirstRun` (pick data folder + seller home state) before the main shell.

- [ ] **Step 1: Write the theme**

`src/renderer/theme.css`:
```css
:root {
  --bg: #f5f7fa; --panel: #ffffff; --text: #1a1a1a; --muted: #555;
  --accent: #1565c0; --accent-text: #ffffff; --border: #cfd8dc; --danger: #c62828;
  --ok: #2e7d32; --warn: #ef6c00;
  color-scheme: light;
}
* { box-sizing: border-box; }
body { margin: 0; font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
  font-size: 18px; color: var(--text); background: var(--bg); }
h1 { font-size: 30px; } h2 { font-size: 24px; }
input, select, textarea {
  font-size: 18px; padding: 10px 12px; border: 1px solid var(--border); border-radius: 8px;
  background: #ffffff !important; color: #1a1a1a !important;   /* never inherit OS dark mode */
}
button { font-size: 18px; padding: 12px 18px; border-radius: 10px; border: 1px solid var(--border);
  background: var(--panel); color: var(--text); cursor: pointer; }
button.primary { background: var(--accent); color: var(--accent-text); border-color: var(--accent); }
button.danger { color: var(--danger); border-color: var(--danger); }
.app { display: flex; min-height: 100vh; }
.sidebar { width: 230px; background: var(--panel); border-right: 1px solid var(--border); padding: 16px; }
.sidebar a { display: block; padding: 14px 16px; margin-bottom: 6px; border-radius: 10px;
  color: var(--text); text-decoration: none; }
.sidebar a.active { background: var(--accent); color: var(--accent-text); }
.content { flex: 1; padding: 28px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; padding: 20px; margin-bottom: 20px; }
table { width: 100%; border-collapse: collapse; background: var(--panel); }
th, td { text-align: left; padding: 12px; border-bottom: 1px solid var(--border); }
.field { display: flex; flex-direction: column; gap: 6px; margin-bottom: 14px; }
.field label { color: var(--muted); font-size: 15px; }
.row { display: flex; gap: 16px; flex-wrap: wrap; }
.error { color: var(--danger); } .grow { flex: 1; }
```

- [ ] **Step 2: Write the failing sidebar test**

`tests/renderer/sidebar.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import Sidebar from '../../src/renderer/components/Sidebar'

describe('Sidebar', () => {
  it('shows all six navigation items', () => {
    render(<HashRouter><Sidebar /></HashRouter>)
    for (const label of ['Dashboard','Purchases','Sales','Stock','Customers','Settings'])
      expect(screen.getByText(label)).toBeTruthy()
  })
})
```

- [ ] **Step 3: Run test, verify it fails**

Run: `npx vitest run tests/renderer/sidebar.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement Sidebar + routes + FirstRun + App**

`src/renderer/components/Sidebar.tsx`:
```tsx
import { NavLink } from 'react-router-dom'
const items = [
  ['/', 'Dashboard'], ['/purchases', 'Purchases'], ['/sales', 'Sales'],
  ['/stock', 'Stock'], ['/customers', 'Customers'], ['/settings', 'Settings']
] as const
export default function Sidebar() {
  return (
    <nav className="sidebar">
      <h2 style={{ marginTop: 0 }}>Granule Trader</h2>
      {items.map(([to, label]) => (
        <NavLink key={to} to={to} end={to === '/'}
          className={({ isActive }) => isActive ? 'active' : ''}>{label}</NavLink>
      ))}
    </nav>
  )
}
```

`src/renderer/routes.tsx`:
```tsx
import { Routes, Route } from 'react-router-dom'
import Dashboard from './screens/Dashboard'
import Purchases from './screens/Purchases'
import Sales from './screens/Sales'
import NewSale from './screens/NewSale'
import Stock from './screens/Stock'
import Customers from './screens/Customers'
import Settings from './screens/Settings'
export default function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/purchases" element={<Purchases />} />
      <Route path="/sales" element={<Sales />} />
      <Route path="/sales/new" element={<NewSale />} />
      <Route path="/sales/fill/:id" element={<NewSale />} />
      <Route path="/stock" element={<Stock />} />
      <Route path="/customers" element={<Customers />} />
      <Route path="/settings" element={<Settings />} />
    </Routes>
  )
}
```

`src/renderer/screens/FirstRun.tsx`:
```tsx
import { useState } from 'react'
export default function FirstRun({ onDone }: { onDone: () => void }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [homeState, setHomeState] = useState('')
  const [seller, setSeller] = useState('')
  async function pick() { setFolder(await window.api.chooseDataFolder()) }
  async function save() {
    await window.api.saveSettings({ home_state: homeState.trim(), seller_name: seller.trim() })
    onDone()
  }
  return (
    <div className="content">
      <h1>Welcome</h1>
      <div className="panel">
        <p>Choose the folder where your data file will live. A cloud-synced folder (Dropbox, Google Drive, iCloud) lets a second computer use the same data — but only open it on one computer at a time.</p>
        <button onClick={pick}>Choose data folder…</button>
        {folder && <p>Selected: <b>{folder}</b></p>}
      </div>
      <div className="panel">
        <div className="field"><label>Your business name</label>
          <input value={seller} onChange={e => setSeller(e.target.value)} /></div>
        <div className="field"><label>Your home state (for tax)</label>
          <input value={homeState} onChange={e => setHomeState(e.target.value)} placeholder="e.g. Gujarat" /></div>
        <button className="primary" disabled={!folder || !homeState.trim()} onClick={save}>Start using Granule Trader</button>
      </div>
    </div>
  )
}
```

`src/renderer/App.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import './theme.css'
import Sidebar from './components/Sidebar'
import AppRoutes from './routes'
import FirstRun from './screens/FirstRun'

export default function App() {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  useEffect(() => { window.api.needsSetup().then(n => { setNeedsSetup(n); setReady(true) }) }, [])
  if (!ready) return <div className="content">Loading…</div>
  if (needsSetup) return <FirstRun onDone={() => setNeedsSetup(false)} />
  return (
    <HashRouter>
      <div className="app"><Sidebar /><main className="content grow"><AppRoutes /></main></div>
    </HashRouter>
  )
}
```

- [ ] **Step 5: Create placeholder screen stubs so routes compile**

Create each of these minimal files (replaced in later tasks). Example for `src/renderer/screens/Dashboard.tsx`:
```tsx
export default function Dashboard() { return <h1>Dashboard</h1> }
```
Repeat verbatim (changing the name) for `Purchases.tsx`, `Sales.tsx`, `NewSale.tsx`, `Stock.tsx`, `Customers.tsx`, `Settings.tsx`.

- [ ] **Step 6: Run test + boot**

Run: `npx vitest run tests/renderer/sidebar.test.tsx`
Expected: PASS.
Run: `npm run dev`
Expected: app opens; first launch shows the Welcome/FirstRun screen; after choosing a folder + home state, the sidebar shell appears.

- [ ] **Step 7: Commit**

```bash
git add src/renderer tests/renderer/sidebar.test.tsx
git commit -m "feat: app shell — light theme, router, sidebar, first-run setup"
```

---

### Task 16: Shared formatting helpers + Settings screen

**Files:**
- Create: `src/renderer/lib/format.ts`, `src/renderer/components/MoneyInput.tsx`, `src/renderer/screens/Settings.tsx` (replace stub)
- Test: `tests/renderer/format.test.ts`, `tests/renderer/money-input.test.tsx`

**Interfaces:**
- Produces:
  - `formatINR(n: number): string` → `"₹1,180.00"` (Indian grouping).
  - `today(): string` → local date as `'YYYY-MM-DD'`.
  - `MoneyInput({ value, onChange, id? })` — a numeric text input that reports a `number` via `onChange(n: number)`; empty → `0`.
- Consumes: `window.api.getSettings`, `window.api.saveSettings`, `window.api.backupNow`, `window.api.listHsn`, `window.api.upsertHsn`.

- [ ] **Step 1: Write the failing tests**

`tests/renderer/format.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { formatINR } from '../../src/renderer/lib/format'
describe('formatINR', () => {
  it('uses Indian grouping with two decimals', () => { expect(formatINR(1180)).toBe('₹1,180.00') })
  it('groups lakhs', () => { expect(formatINR(125000.5)).toBe('₹1,25,000.50') })
})
```

`tests/renderer/money-input.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import MoneyInput from '../../src/renderer/components/MoneyInput'
describe('MoneyInput', () => {
  it('reports a number on change and treats empty as 0', () => {
    const onChange = vi.fn()
    render(<MoneyInput value={0} onChange={onChange} id="amt" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234.5' } })
    expect(onChange).toHaveBeenCalledWith(1234.5)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})
```

- [ ] **Step 2: Run tests, verify they fail**

Run: `npx vitest run tests/renderer/format.test.ts tests/renderer/money-input.test.tsx`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement format + MoneyInput**

`src/renderer/lib/format.ts`:
```ts
export function formatINR(n: number): string {
  return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
export function today(): string {
  const d = new Date()
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
```

`src/renderer/components/MoneyInput.tsx`:
```tsx
export default function MoneyInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  return (
    <input id={id} type="text" inputMode="decimal" value={value === 0 ? '' : String(value)}
      onChange={e => {
        const v = e.target.value.trim()
        onChange(v === '' ? 0 : (Number.isNaN(Number(v)) ? value : Number(v)))
      }} />
  )
}
```

- [ ] **Step 4: Run those tests, verify they pass**

Run: `npx vitest run tests/renderer/format.test.ts tests/renderer/money-input.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Implement Settings screen**

`src/renderer/screens/Settings.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Settings as S, HsnProduct } from '@shared/types'
import MoneyInput from '../components/MoneyInput'

export default function Settings() {
  const [s, setS] = useState<S | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [msg, setMsg] = useState('')
  const [newHsn, setNewHsn] = useState<HsnProduct>({ hsn_code: '', description: '', gst_rate: 18 })

  async function reload() { setS(await window.api.getSettings()); setHsn(await window.api.listHsn()) }
  useEffect(() => { reload() }, [])
  if (!s) return <h1>Settings</h1>
  const set = (patch: Partial<S>) => setS({ ...s, ...patch })

  async function save() { await window.api.saveSettings(s); setMsg('Saved.'); setTimeout(() => setMsg(''), 2000) }
  async function backup() { const p = await window.api.backupNow(); setMsg(`Backup written: ${p}`) }
  async function addHsn() {
    if (!newHsn.hsn_code.trim()) return
    await window.api.upsertHsn(newHsn); setNewHsn({ hsn_code: '', description: '', gst_rate: 18 }); reload()
  }

  return (
    <div>
      <h1>Settings</h1>
      {msg && <p className="ok">{msg}</p>}
      <div className="panel">
        <h2>Business</h2>
        <div className="row">
          <div className="field grow"><label>Business name</label><input value={s.seller_name} onChange={e => set({ seller_name: e.target.value })} /></div>
          <div className="field grow"><label>GSTIN</label><input value={s.seller_gstin} onChange={e => set({ seller_gstin: e.target.value })} /></div>
          <div className="field grow"><label>PAN</label><input value={s.seller_pan} onChange={e => set({ seller_pan: e.target.value })} /></div>
        </div>
        <div className="field"><label>Address</label><textarea value={s.seller_address} onChange={e => set({ seller_address: e.target.value })} /></div>
        <div className="row">
          <div className="field grow"><label>Home state (tax)</label><input value={s.home_state} onChange={e => set({ home_state: e.target.value })} /></div>
          <div className="field grow"><label>Invoice prefix</label><input value={s.invoice_prefix} onChange={e => set({ invoice_prefix: e.target.value })} /></div>
          <div className="field grow"><label>Default GST rate %</label><MoneyInput value={s.default_gst_rate} onChange={n => set({ default_gst_rate: n })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Low-stock threshold (kg)</label><MoneyInput value={s.low_stock_threshold} onChange={n => set({ low_stock_threshold: n })} /></div>
          <div className="field grow"><label>Backups to keep</label><MoneyInput value={s.backups_to_keep} onChange={n => set({ backups_to_keep: n })} /></div>
          <div className="field grow"><label>Data folder</label><input value={s.data_folder} readOnly /></div>
        </div>
        <button className="primary" onClick={save}>Save settings</button>{' '}
        <button onClick={backup}>Backup now</button>
      </div>

      <div className="panel">
        <h2>Products (HSN)</h2>
        <table><thead><tr><th>HSN</th><th>Description</th><th>GST %</th></tr></thead>
          <tbody>{hsn.map(h => <tr key={h.hsn_code}><td>{h.hsn_code}</td><td>{h.description}</td><td>{h.gst_rate}</td></tr>)}</tbody>
        </table>
        <div className="row" style={{ marginTop: 12 }}>
          <div className="field"><label>HSN code</label><input value={newHsn.hsn_code} onChange={e => setNewHsn({ ...newHsn, hsn_code: e.target.value })} /></div>
          <div className="field grow"><label>Description</label><input value={newHsn.description} onChange={e => setNewHsn({ ...newHsn, description: e.target.value })} /></div>
          <div className="field"><label>GST %</label><MoneyInput value={newHsn.gst_rate} onChange={n => setNewHsn({ ...newHsn, gst_rate: n })} /></div>
          <div className="field" style={{ justifyContent: 'flex-end' }}><button onClick={addHsn}>Add / update</button></div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Verify in app**

Run: `npm run dev` → open **Settings**. Confirm: fields load, Save shows "Saved.", "Backup now" reports a path, adding an HSN row appears in the table. Inputs are white with dark text.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/format.ts src/renderer/components/MoneyInput.tsx src/renderer/screens/Settings.tsx tests/renderer/format.test.ts tests/renderer/money-input.test.tsx
git commit -m "feat: formatting helpers, MoneyInput, Settings screen (business/HSN)"
```

---

### Task 17: Customers screen

**Files:**
- Create: `src/renderer/screens/Customers.tsx` (replace stub)

**Interfaces:**
- Consumes: `window.api.listCustomers`, `createCustomer`, `updateCustomer`, `deleteCustomer`.

- [ ] **Step 1: Implement the screen**

`src/renderer/screens/Customers.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Customer } from '@shared/types'

const EMPTY: Omit<Customer, 'id'> = {
  name: '', gstin: '', pan: '', phone: '',
  billing_address: '', billing_city: '', billing_state: '', billing_pincode: '',
  shipping_same: true, shipping_address: '', shipping_city: '', shipping_state: '', shipping_pincode: ''
}

export default function Customers() {
  const [list, setList] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<Omit<Customer, 'id'>>(EMPTY)

  async function reload() { setList(await window.api.listCustomers(search || undefined)) }
  useEffect(() => { reload() }, [search])
  const set = (p: Partial<Omit<Customer, 'id'>>) => setForm({ ...form, ...p })

  function edit(c: Customer) { const { id, ...rest } = c; setEditId(id); setForm(rest) }
  function reset() { setEditId(null); setForm(EMPTY) }
  async function save() {
    if (!form.name.trim()) return
    if (editId) await window.api.updateCustomer(editId, form)
    else await window.api.createCustomer(form)
    reset(); reload()
  }
  async function remove(id: number) { if (confirm('Delete this customer?')) { await window.api.deleteCustomer(id); reload() } }

  return (
    <div>
      <h1>Customers</h1>
      <div className="panel">
        <input placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.target.value)} style={{ width: 360 }} />
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>Name</th><th>GSTIN</th><th>City</th><th>State</th><th></th></tr></thead>
          <tbody>{list.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td><td>{c.gstin}</td><td>{c.billing_city}</td><td>{c.billing_state}</td>
              <td><button onClick={() => edit(c)}>Edit</button> <button className="danger" onClick={() => remove(c.id)}>Delete</button></td>
            </tr>))}</tbody>
        </table>
      </div>

      <div className="panel">
        <h2>{editId ? 'Edit customer' : 'New customer'}</h2>
        <div className="row">
          <div className="field grow"><label>Name</label><input value={form.name} onChange={e => set({ name: e.target.value })} /></div>
          <div className="field grow"><label>GSTIN</label><input value={form.gstin} onChange={e => set({ gstin: e.target.value })} /></div>
          <div className="field"><label>PAN</label><input value={form.pan} onChange={e => set({ pan: e.target.value })} /></div>
          <div className="field"><label>Phone</label><input value={form.phone} onChange={e => set({ phone: e.target.value })} /></div>
        </div>
        <h3>Billing</h3>
        <div className="field"><label>Address</label><textarea value={form.billing_address} onChange={e => set({ billing_address: e.target.value })} /></div>
        <div className="row">
          <div className="field grow"><label>City</label><input value={form.billing_city} onChange={e => set({ billing_city: e.target.value })} /></div>
          <div className="field grow"><label>State</label><input value={form.billing_state} onChange={e => set({ billing_state: e.target.value })} /></div>
          <div className="field"><label>Pincode</label><input value={form.billing_pincode} onChange={e => set({ billing_pincode: e.target.value })} /></div>
        </div>
        <label style={{ display: 'block', margin: '8px 0' }}>
          <input type="checkbox" checked={form.shipping_same} onChange={e => set({ shipping_same: e.target.checked })} /> Shipping same as billing
        </label>
        {!form.shipping_same && (
          <>
            <h3>Shipping</h3>
            <div className="field"><label>Address</label><textarea value={form.shipping_address} onChange={e => set({ shipping_address: e.target.value })} /></div>
            <div className="row">
              <div className="field grow"><label>City</label><input value={form.shipping_city} onChange={e => set({ shipping_city: e.target.value })} /></div>
              <div className="field grow"><label>State</label><input value={form.shipping_state} onChange={e => set({ shipping_state: e.target.value })} /></div>
              <div className="field"><label>Pincode</label><input value={form.shipping_pincode} onChange={e => set({ shipping_pincode: e.target.value })} /></div>
            </div>
          </>
        )}
        <button className="primary" onClick={save}>{editId ? 'Update' : 'Add'} customer</button>{' '}
        {editId && <button onClick={reset}>Cancel</button>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in app**

Run: `npm run dev` → **Customers**. Add a customer, confirm it appears; edit it; toggle "Shipping same as billing" reveals/hides shipping fields; search filters; delete works.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/screens/Customers.tsx
git commit -m "feat: customers screen (search, add/edit, shipping toggle)"
```

---

### Task 18: Purchases screen

**Files:**
- Create: `src/renderer/screens/Purchases.tsx` (replace stub)

**Interfaces:**
- Consumes: `window.api.listPurchases`, `nextPurchaseCode`, `createPurchase`, `deletePurchase`, `getSettings`, `listHsn`.
- Note: builds a `NewPurchase` (fields from Task 6). `homeState` comes from settings; `gst_rate` from the chosen HSN (fallback default). Live tax summary mirrors `computeTax`.

- [ ] **Step 1: Implement the screen**

`src/renderer/screens/Purchases.tsx`:
```tsx
import { useEffect, useState } from 'react'
import type { Purchase, HsnProduct, Settings } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import { formatINR, today } from '../lib/format'

export default function Purchases() {
  const [list, setList] = useState<Purchase[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [form, setForm] = useState({
    our_code: '', supplier_invoice_number: '', invoice_date: today(),
    party: '', party_state: '', hsn_code: '', qty_kg: 0, amount: 0,
    tcs: 0, roundoff: 0, payment_status: 'pending' as 'pending' | 'done'
  })
  const [error, setError] = useState('')

  async function reload() { setList(await window.api.listPurchases()) }
  useEffect(() => { (async () => {
    setSettings(await window.api.getSettings()); setHsn(await window.api.listHsn()); reload()
  })() }, [])
  // suggest next code whenever the date changes
  useEffect(() => { window.api.nextPurchaseCode(form.invoice_date).then(c => setForm(f => ({ ...f, our_code: c }))) }, [form.invoice_date])

  if (!settings) return <h1>Purchases</h1>
  const gstRate = hsn.find(h => h.hsn_code === form.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const intra = form.party_state.trim().toLowerCase() === settings.home_state.trim().toLowerCase()
  const tax = round2(form.amount * gstRate / 100)
  const cgst = intra ? round2(tax / 2) : 0
  const igst = intra ? 0 : tax
  const total = round2(form.amount + cgst * 2 + igst + form.tcs + form.roundoff)

  async function save() {
    setError('')
    try {
      await window.api.createPurchase({
        our_code: form.our_code, supplier_invoice_number: form.supplier_invoice_number,
        invoice_date: form.invoice_date, party: form.party, party_state: form.party_state,
        hsn_code: form.hsn_code, qty_kg: form.qty_kg, amount: form.amount, gst_rate: gstRate,
        homeState: settings!.home_state, tcs: form.tcs, roundoff: form.roundoff, payment_status: form.payment_status
      })
      setForm(f => ({ ...f, supplier_invoice_number: '', party: '', party_state: '', qty_kg: 0, amount: 0, tcs: 0, roundoff: 0 }))
      reload()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }
  async function remove(id: number) {
    setError('')
    try { if (confirm('Delete this purchase? Stock will be recalculated.')) { await window.api.deletePurchase(id); reload() } }
    catch (e: any) { setError(e.message ?? String(e)) }
  }
  const set = (p: Partial<typeof form>) => setForm({ ...form, ...p })

  return (
    <div>
      <h1>Purchases</h1>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <h2>New purchase</h2>
        <div className="row">
          <div className="field"><label>Our code</label><input value={form.our_code} onChange={e => set({ our_code: e.target.value })} /></div>
          <div className="field grow"><label>Supplier invoice no.</label><input value={form.supplier_invoice_number} onChange={e => set({ supplier_invoice_number: e.target.value })} /></div>
          <div className="field"><label>Invoice date</label><input type="date" value={form.invoice_date} onChange={e => set({ invoice_date: e.target.value })} /></div>
        </div>
        <div className="row">
          <div className="field grow"><label>Supplier (party)</label><input value={form.party} onChange={e => set({ party: e.target.value })} /></div>
          <div className="field grow"><label>Supplier state</label><input value={form.party_state} onChange={e => set({ party_state: e.target.value })} placeholder="e.g. Gujarat" /></div>
          <div className="field"><label>HSN</label>
            <select value={form.hsn_code} onChange={e => set({ hsn_code: e.target.value })}>
              <option value="">—</option>
              {hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
            </select>
          </div>
        </div>
        <div className="row">
          <div className="field"><label>Quantity (kg)</label><MoneyInput value={form.qty_kg} onChange={n => set({ qty_kg: n })} /></div>
          <div className="field"><label>Taxable amount</label><MoneyInput value={form.amount} onChange={n => set({ amount: n })} /></div>
          <div className="field"><label>TCS</label><MoneyInput value={form.tcs} onChange={n => set({ tcs: n })} /></div>
          <div className="field"><label>Round off</label><MoneyInput value={form.roundoff} onChange={n => set({ roundoff: n })} /></div>
          <div className="field"><label>Payment</label>
            <select value={form.payment_status} onChange={e => set({ payment_status: e.target.value as 'pending' | 'done' })}>
              <option value="pending">Pending</option><option value="done">Done</option>
            </select>
          </div>
        </div>
        <p>GST {gstRate}% → {intra ? `CGST ${formatINR(cgst)} + SGST ${formatINR(cgst)}` : `IGST ${formatINR(igst)}`} · <b>Total {formatINR(total)}</b></p>
        <button className="primary" onClick={save}>Save purchase (adds to stock)</button>
      </div>

      <div className="panel">
        <h2>All purchases</h2>
        <table>
          <thead><tr><th>Code</th><th>Date</th><th>Supplier</th><th>HSN</th><th>Qty</th><th>Remaining</th><th>Total</th><th>Pay</th><th></th></tr></thead>
          <tbody>{list.map(p => (
            <tr key={p.id}>
              <td>{p.our_code}</td><td>{p.invoice_date}</td><td>{p.party}</td><td>{p.hsn_code}</td>
              <td>{p.qty_kg}</td><td>{p.qty_remaining_kg}</td><td>{formatINR(p.total_invoice_amount)}</td>
              <td>{p.payment_status}</td>
              <td><button className="danger" onClick={() => remove(p.id)}>Delete</button></td>
            </tr>))}</tbody>
        </table>
      </div>
    </div>
  )

  function round2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100 }
}
```

- [ ] **Step 2: Verify in app**

Run: `npm run dev` → **Purchases**. Confirm: the date drives an auto-suggested editable "Our code"; selecting an HSN updates the live tax line; same-state supplier shows CGST+SGST, other-state shows IGST; saving adds a row with `Remaining = Qty`; delete removes it (and is blocked once a sale uses the lot — tested later).

- [ ] **Step 3: Commit**

```bash
git add src/renderer/screens/Purchases.tsx
git commit -m "feat: purchases screen with live tax summary + auto code"
```

---

### Task 19: Sales register + New Sale flow

**Files:**
- Create: `src/renderer/lib/allocation.ts`, `src/renderer/screens/Sales.tsx` (replace stub), `src/renderer/screens/NewSale.tsx` (replace stub)
- Test: `tests/renderer/allocation.test.ts`

**Interfaces:**
- Produces (`allocation.ts`):
  ```ts
  export interface UiLine { purchase_id: number; qty_drawn_kg: number; rate_per_kg: number }
  export function allocationSummary(lines: UiLine[]): { totalQty: number; amount: number }
  // amount = sum(round2(qty*rate)); totalQty = sum(qty), both round2.
  ```
- Consumes: `window.api.listSales`, `listAvailableLots`, `nextInvoiceNumber`, `createSale`, `fillReservedSale`, `getSaleWithAllocations`, `deleteSale`, `listCustomers`, `getSettings`, `listHsn`.
- NewSale builds a `NewSale` (Task 10). When the route is `/sales/fill/:id`, it loads the reserved row and calls `fillReservedSale`; otherwise `createSale`. "Save & generate invoice PDF" navigates to the printable invoice (Task 22) after saving.

- [ ] **Step 1: Write the failing test**

`tests/renderer/allocation.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { allocationSummary } from '../../src/renderer/lib/allocation'
describe('allocationSummary', () => {
  it('sums quantity and line amounts', () => {
    const r = allocationSummary([
      { purchase_id: 1, qty_drawn_kg: 600, rate_per_kg: 80 },
      { purchase_id: 2, qty_drawn_kg: 400, rate_per_kg: 90 }
    ])
    expect(r).toEqual({ totalQty: 1000, amount: 84000 })
  })
  it('handles an empty list', () => { expect(allocationSummary([])).toEqual({ totalQty: 0, amount: 0 }) })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/renderer/allocation.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

`src/renderer/lib/allocation.ts`:
```ts
export interface UiLine { purchase_id: number; qty_drawn_kg: number; rate_per_kg: number }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export function allocationSummary(lines: UiLine[]): { totalQty: number; amount: number } {
  let totalQty = 0, amount = 0
  for (const l of lines) { totalQty = r2(totalQty + l.qty_drawn_kg); amount = r2(amount + r2(l.qty_drawn_kg * l.rate_per_kg)) }
  return { totalQty, amount }
}
```

- [ ] **Step 4: Run test, verify it passes**

Run: `npx vitest run tests/renderer/allocation.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Implement the Sales register**

`src/renderer/screens/Sales.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Sale } from '@shared/types'
import { formatINR } from '../lib/format'

export default function Sales() {
  const [list, setList] = useState<Sale[]>([])
  const nav = useNavigate()
  async function reload() { setList(await window.api.listSales()) }
  useEffect(() => { reload() }, [])
  async function remove(id: number) { if (confirm('Delete this sale? Stock will be restored.')) { await window.api.deleteSale(id); reload() } }

  return (
    <div>
      <h1>Sales</h1>
      <div className="panel">
        <button className="primary" onClick={() => nav('/sales/new')}>+ New sale</button>
      </div>
      <div className="panel">
        <table>
          <thead><tr><th>Invoice</th><th>Date</th><th>Buyer</th><th>Qty</th><th>Total</th><th>Pay</th><th></th></tr></thead>
          <tbody>{list.map(s => s.status === 'reserved' ? (
            <tr key={s.id} style={{ color: 'var(--muted)' }}>
              <td>{s.invoice_number}</td><td colSpan={4}><i>reserved — blank</i></td><td></td>
              <td><button onClick={() => nav(`/sales/fill/${s.id}`)}>Fill</button></td>
            </tr>
          ) : (
            <tr key={s.id}>
              <td>{s.invoice_number}</td><td>{s.invoice_date}</td><td>{s.buyer_name}</td>
              <td>{s.total_qty_kg}</td><td>{formatINR(s.total_invoice_amount)}</td><td>{s.payment_status}</td>
              <td><button className="danger" onClick={() => remove(s.id)}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 6: Implement the New Sale flow**

`src/renderer/screens/NewSale.tsx`:
```tsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Customer, AvailableLot, Settings, HsnProduct } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import { formatINR, today } from '../lib/format'
import { allocationSummary, type UiLine } from '../lib/allocation'
import { placeOfSupplyState } from '../../main/core/customers'   // pure helper, type-safe to import

export default function NewSale() {
  const nav = useNavigate()
  const { id } = useParams()                 // present on /sales/fill/:id
  const fillId = id ? Number(id) : null
  const [settings, setSettings] = useState<Settings | null>(null)
  const [customers, setCustomers] = useState<Customer[]>([])
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [lots, setLots] = useState<AvailableLot[]>([])
  const [error, setError] = useState('')

  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today())
  const [buyerId, setBuyerId] = useState<number | null>(null)
  const [hsnCode, setHsnCode] = useState('')
  const [evwBillNo, setEvwBillNo] = useState('')
  const [evwBillDate, setEvwBillDate] = useState('')
  const [vehicle, setVehicle] = useState('')
  const [tcs, setTcs] = useState(0)
  const [roundoff, setRoundoff] = useState(0)
  const [draw, setDraw] = useState<Record<number, { qty: number; rate: number }>>({})

  useEffect(() => { (async () => {
    setSettings(await window.api.getSettings())
    setCustomers(await window.api.listCustomers())
    setHsn(await window.api.listHsn())
    if (fillId) {
      const { sale } = await window.api.getSaleWithAllocations(fillId)
      setInvoiceNumber(sale.invoice_number)
      setInvoiceDate(sale.invoice_date ?? today())
    }
  })() }, [fillId])

  // refresh available lots whenever the date changes (date-aware, excluding this sale when filling)
  useEffect(() => { window.api.listAvailableLots(invoiceDate, fillId ?? undefined).then(setLots) }, [invoiceDate, fillId])
  // suggest invoice number for a fresh sale
  useEffect(() => { if (!fillId && settings) window.api.nextInvoiceNumber(invoiceDate, settings.invoice_prefix).then(setInvoiceNumber) }, [invoiceDate, settings, fillId])

  const buyer = customers.find(c => c.id === buyerId) ?? null
  const placeOfSupply = buyer ? placeOfSupplyState(buyer) : ''
  const gstRate = hsn.find(h => h.hsn_code === hsnCode)?.gst_rate ?? settings?.default_gst_rate ?? 18
  const intra = !!settings && placeOfSupply.trim().toLowerCase() === settings.home_state.trim().toLowerCase()

  const lines: UiLine[] = useMemo(() => Object.entries(draw)
    .filter(([, d]) => d.qty > 0)
    .map(([pid, d]) => ({ purchase_id: Number(pid), qty_drawn_kg: d.qty, rate_per_kg: d.rate })), [draw])
  const summary = allocationSummary(lines)
  const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
  const taxTotal = r2(summary.amount * gstRate / 100)
  const cgst = intra ? r2(taxTotal / 2) : 0
  const igst = intra ? 0 : taxTotal
  const grandTotal = r2(summary.amount + cgst * 2 + igst + tcs + roundoff)

  function setLine(pid: number, patch: Partial<{ qty: number; rate: number }>) {
    setDraw(d => ({ ...d, [pid]: { qty: 0, rate: 0, ...d[pid], ...patch } }))
  }

  async function save(thenInvoice: boolean) {
    setError('')
    if (!buyer) { setError('Choose a buyer first.'); return }
    if (lines.length === 0) { setError('Allocate quantity from at least one lot.'); return }
    const payload = {
      invoice_number: invoiceNumber, invoice_date: invoiceDate,
      buyer_customer_id: buyer.id, buyer_name: buyer.name, buyer_gstin: buyer.gstin,
      buyer_billing: { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode },
      buyer_shipping: buyer.shipping_same
        ? { address: buyer.billing_address, city: buyer.billing_city, state: buyer.billing_state, pincode: buyer.billing_pincode }
        : { address: buyer.shipping_address, city: buyer.shipping_city, state: buyer.shipping_state, pincode: buyer.shipping_pincode },
      place_of_supply_state: placeOfSupply, homeState: settings!.home_state, hsn_code: hsnCode, gst_rate: gstRate,
      lines, tcs, roundoff, eway_bill_no: evwBillNo, eway_bill_date: evwBillDate, vehicle
    }
    try {
      const sale = fillId ? await window.api.fillReservedSale(fillId, payload) : await window.api.createSale(payload)
      if (thenInvoice) nav(`/sales?invoice=${sale.id}`)   // Task 22 reads ?invoice= to open the printable view
      else nav('/sales')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  if (!settings) return <h1>New sale</h1>
  return (
    <div>
      <h1>{fillId ? 'Fill reserved invoice' : 'New sale'}</h1>
      {error && <p className="error">{error}</p>}
      <div className="panel">
        <div className="row">
          <div className="field"><label>Invoice number</label><input value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
          <div className="field"><label>Invoice date</label><input type="date" value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} /></div>
          <div className="field grow"><label>Buyer</label>
            <select value={buyerId ?? ''} onChange={e => setBuyerId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">— choose customer —</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.gstin ? ` (${c.gstin})` : ''}</option>)}
            </select>
          </div>
          <div className="field"><label>HSN</label>
            <select value={hsnCode} onChange={e => setHsnCode(e.target.value)}>
              <option value="">—</option>
              {hsn.map(h => <option key={h.hsn_code} value={h.hsn_code}>{h.hsn_code} ({h.gst_rate}%)</option>)}
            </select>
          </div>
        </div>
        {buyer && <p>Place of supply: <b>{placeOfSupply}</b> → {intra ? 'CGST + SGST' : 'IGST'}</p>}
        <div className="row">
          <div className="field"><label>E-way bill no.</label><input value={evwBillNo} onChange={e => setEvwBillNo(e.target.value)} /></div>
          <div className="field"><label>E-way bill date</label><input type="date" value={evwBillDate} onChange={e => setEvwBillDate(e.target.value)} /></div>
          <div className="field grow"><label>Vehicle</label><input value={vehicle} onChange={e => setVehicle(e.target.value)} placeholder="By Taxi / By Van / GJ-05-..." /></div>
        </div>
      </div>

      <div className="panel">
        <h2>Allocate from stock (lots available on {invoiceDate})</h2>
        <table>
          <thead><tr><th>Lot</th><th>Supplier</th><th>Available</th><th>Draw (kg)</th><th>Rate/kg</th><th>Amount</th></tr></thead>
          <tbody>{lots.map(l => {
            const d = draw[l.purchase_id] ?? { qty: 0, rate: 0 }
            return (
              <tr key={l.purchase_id}>
                <td>{l.our_code}</td><td>{l.party}</td><td>{l.available_kg}</td>
                <td><MoneyInput value={d.qty} onChange={n => setLine(l.purchase_id, { qty: n })} /></td>
                <td><MoneyInput value={d.rate} onChange={n => setLine(l.purchase_id, { rate: n })} /></td>
                <td>{formatINR(r2(d.qty * d.rate))}</td>
              </tr>)
          })}</tbody>
        </table>
        {lots.length === 0 && <p className="error">No stock available on this date.</p>}
      </div>

      <div className="panel">
        <div className="row">
          <div className="field"><label>TCS</label><MoneyInput value={tcs} onChange={setTcs} /></div>
          <div className="field"><label>Round off</label><MoneyInput value={roundoff} onChange={setRoundoff} /></div>
        </div>
        <p>Taxable {formatINR(summary.amount)} · {intra ? `CGST ${formatINR(cgst)} + SGST ${formatINR(cgst)}` : `IGST ${formatINR(igst)}`} · Qty {summary.totalQty} kg · <b>Total {formatINR(grandTotal)}</b></p>
        <button className="primary" onClick={() => save(false)}>Save sale &amp; draw stock</button>{' '}
        <button onClick={() => save(true)}>Save &amp; generate invoice PDF</button>{' '}
        <button onClick={() => nav('/sales')}>Cancel</button>
      </div>
    </div>
  )

  function r2(n: number) { return Math.round((n + Number.EPSILON) * 100) / 100 }
}
```

- [ ] **Step 7: Verify in app**

Run: `npm run dev`. Create at least two purchases first. Then **Sales → New sale**: pick a buyer, set HSN, allocate across lots with per-lot rates, watch the live taxable/tax/total update; place of supply drives CGST+SGST vs IGST. Save → row appears in the register and the lots' Remaining dropped. Edit the invoice number to jump ahead (e.g. `…/005/…` when next is `003`) → the skipped numbers appear as **reserved** rows with a **Fill** button. Try over-drawing a lot → a clear error, nothing saved. Delete a created sale → stock restored.

- [ ] **Step 8: Commit**

```bash
git add src/renderer/lib/allocation.ts src/renderer/screens/Sales.tsx src/renderer/screens/NewSale.tsx tests/renderer/allocation.test.ts
git commit -m "feat: sales register + new-sale flow (per-lot allocation, live tax, reservation, fill)"
```

---

### Task 20: Stock screen + adjustment

**Files:**
- Create: `src/renderer/screens/Stock.tsx` (replace stub)

**Interfaces:**
- Consumes: `window.api.stockLedger`, `createStockAdjustment`, `getSettings`. "New sale from stock" navigates to `/sales/new`.

- [ ] **Step 1: Implement the screen**

`src/renderer/screens/Stock.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LedgerRow, Settings } from '@shared/types'
import MoneyInput from '../components/MoneyInput'
import { today } from '../lib/format'

export default function Stock() {
  const nav = useNavigate()
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [adj, setAdj] = useState<{ purchase_id: number | null; qty_kg: number; reason: string; date: string }>(
    { purchase_id: null, qty_kg: 0, reason: '', date: today() })
  const [error, setError] = useState('')

  async function reload() { setRows(await window.api.stockLedger()) }
  useEffect(() => { (async () => { setSettings(await window.api.getSettings()); reload() })() }, [])

  async function saveAdj() {
    setError('')
    if (!adj.purchase_id || adj.qty_kg <= 0) { setError('Choose a lot and a quantity.'); return }
    try {
      await window.api.createStockAdjustment({ purchase_id: adj.purchase_id, qty_kg: adj.qty_kg, reason: adj.reason, date: adj.date })
      setAdj({ purchase_id: null, qty_kg: 0, reason: '', date: today() }); reload()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  // running balance per HSN group
  let lastHsn = ''
  let running = 0
  const low = settings?.low_stock_threshold ?? 0

  return (
    <div>
      <h1>Stock</h1>
      <div className="panel"><button className="primary" onClick={() => nav('/sales/new')}>New sale from stock</button></div>
      {error && <p className="error">{error}</p>}

      <div className="panel">
        <h2>Stock statement (per lot)</h2>
        <table>
          <thead><tr><th>HSN</th><th>Lot</th><th>Date</th><th>Supplier</th><th>In</th><th>Consumed</th><th>Balance</th><th>Running</th></tr></thead>
          <tbody>{rows.map(r => {
            if (r.hsn_code !== lastHsn) { lastHsn = r.hsn_code; running = 0 }
            running += r.balance_kg
            const isLow = r.balance_kg < low
            return (
              <tr key={r.purchase_id} style={isLow ? { background: '#fff3e0' } : undefined}>
                <td>{r.hsn_code}</td><td>{r.our_code}</td><td>{r.invoice_date}</td><td>{r.party}</td>
                <td>{r.qty_kg}</td><td>{r.consumed_kg}</td><td>{r.balance_kg}{isLow ? ' ⚠' : ''}</td><td>{running}</td>
              </tr>)
          })}</tbody>
        </table>
        {rows.length === 0 && <p>No stock on hand.</p>}
      </div>

      <div className="panel">
        <h2>Stock adjustment</h2>
        <div className="row">
          <div className="field grow"><label>Lot</label>
            <select value={adj.purchase_id ?? ''} onChange={e => setAdj({ ...adj, purchase_id: e.target.value ? Number(e.target.value) : null })}>
              <option value="">— choose lot —</option>
              {rows.map(r => <option key={r.purchase_id} value={r.purchase_id}>{r.our_code} — {r.balance_kg} kg left</option>)}
            </select>
          </div>
          <div className="field"><label>Quantity removed (kg)</label><MoneyInput value={adj.qty_kg} onChange={n => setAdj({ ...adj, qty_kg: n })} /></div>
          <div className="field"><label>Date</label><input type="date" value={adj.date} onChange={e => setAdj({ ...adj, date: e.target.value })} /></div>
          <div className="field grow"><label>Reason</label><input value={adj.reason} onChange={e => setAdj({ ...adj, reason: e.target.value })} placeholder="spillage / sample / loss / correction" /></div>
        </div>
        <button onClick={saveAdj}>Record adjustment</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in app**

Run: `npm run dev` → **Stock**. Confirm: lots with balance show grouped by HSN with a running total; lots below the low-stock threshold are highlighted; recording an adjustment reduces that lot's balance; an over-large adjustment shows a clear error and changes nothing.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/screens/Stock.tsx
git commit -m "feat: stock screen (per-lot ledger, running balance, low-stock, adjustments)"
```

---

### Task 21: Dashboard

**Files:**
- Create: `src/renderer/components/KpiCard.tsx`, `src/renderer/screens/Dashboard.tsx` (replace stub)

**Interfaces:**
- Consumes: `window.api.listSales`, `listPurchases`, `stockLedger`, `getSettings`.

- [ ] **Step 1: Implement KpiCard + Dashboard**

`src/renderer/components/KpiCard.tsx`:
```tsx
export default function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel" style={{ flex: 1, minWidth: 200 }}>
      <div style={{ color: 'var(--muted)', fontSize: 15 }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700 }}>{value}</div>
    </div>
  )
}
```

`src/renderer/screens/Dashboard.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Sale, Purchase, LedgerRow, Settings } from '@shared/types'
import KpiCard from '../components/KpiCard'
import { formatINR, today } from '../lib/format'

export default function Dashboard() {
  const nav = useNavigate()
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => { (async () => {
    setSales(await window.api.listSales())
    setPurchases(await window.api.listPurchases())
    setLedger(await window.api.stockLedger())
    setSettings(await window.api.getSettings())
  })() }, [])

  const month = today().slice(0, 7)
  const created = sales.filter(s => s.status === 'created')
  const salesThisMonth = created.filter(s => (s.invoice_date ?? '').startsWith(month))
  const salesTotal = salesThisMonth.reduce((a, s) => a + s.total_invoice_amount, 0)
  const stockOnHand = ledger.reduce((a, r) => a + r.balance_kg, 0)
  const pendingSales = created.filter(s => s.payment_status === 'pending')
  const pendingPurchases = purchases.filter(p => p.payment_status === 'pending')
  const low = settings?.low_stock_threshold ?? 0
  const lowLots = ledger.filter(r => r.balance_kg < low)

  return (
    <div>
      <h1>Welcome{settings?.seller_name ? `, ${settings.seller_name}` : ''}</h1>
      <p style={{ color: 'var(--muted)' }}>{today()}</p>
      <div className="row" style={{ marginBottom: 16 }}>
        <button className="primary" style={{ fontSize: 22, padding: '18px 28px' }} onClick={() => nav('/sales/new')}>New sale</button>
        <button style={{ fontSize: 22, padding: '18px 28px' }} onClick={() => nav('/purchases')}>New purchase</button>
      </div>
      <div className="row">
        <KpiCard label="Sales this month" value={formatINR(salesTotal)} />
        <KpiCard label="Stock on hand" value={`${stockOnHand} kg`} />
        <KpiCard label="Payments pending (sales)" value={String(pendingSales.length)} />
        <KpiCard label="Payments pending (purchases)" value={String(pendingPurchases.length)} />
      </div>
      <div className="panel">
        <h2>Low stock</h2>
        {lowLots.length === 0 ? <p>Nothing below {low} kg.</p> :
          <ul>{lowLots.map(r => <li key={r.purchase_id}>{r.our_code} ({r.hsn_code}) — {r.balance_kg} kg</li>)}</ul>}
      </div>
      <div className="panel">
        <h2>Pending sales payments</h2>
        {pendingSales.length === 0 ? <p>All settled.</p> :
          <ul>{pendingSales.map(s => <li key={s.id}>{s.invoice_number} — {s.buyer_name} — {formatINR(s.total_invoice_amount)}</li>)}</ul>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Verify in app**

Run: `npm run dev` → **Dashboard**. Confirm greeting + date, big New sale / New purchase buttons navigate correctly, KPI cards reflect data, and the low-stock / pending lists populate from real rows.

- [ ] **Step 3: Commit**

```bash
git add src/renderer/components/KpiCard.tsx src/renderer/screens/Dashboard.tsx
git commit -m "feat: dashboard (KPIs, quick actions, attention lists)"
```

---

### Task 22: Invoice template + PDF / print

**Files:**
- Create: `src/renderer/invoice/InvoiceTemplate.tsx`, `src/renderer/invoice/invoice.css`, `src/renderer/screens/InvoiceView.tsx`
- Modify: `src/renderer/routes.tsx` (add `/invoice/:id`), `src/renderer/screens/NewSale.tsx` (navigate to `/invoice/:id` instead of `/sales?invoice=`)
- Test: `tests/renderer/invoice-template.test.tsx`

**Interfaces:**
- Consumes: `window.api.getSaleWithAllocations`, `getSettings`.
- Produces: `InvoiceTemplate({ sale, allocations, settings })` — a self-contained printable block. `InvoiceView` loads data by `:id`, renders the template, and offers **Print / Save as PDF** via `window.print()` (Chromium's print dialog includes "Save as PDF"). The template is the **swappable** layout to be matched to the owner's sample later (Spec §8); structure isolates it so only this file changes.

- [ ] **Step 1: Write the failing test**

`tests/renderer/invoice-template.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InvoiceTemplate from '../../src/renderer/invoice/InvoiceTemplate'
import type { Sale, SaleAllocation, Settings } from '@shared/types'

const settings = { seller_name: 'RP Plastics', seller_address: 'Surat', seller_gstin: '24AAA', seller_pan: 'AAA', home_state: 'Gujarat', invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10 } as Settings
const sale = { id: 1, invoice_number: 'RP/008/2024-25', invoice_date: '2024-05-10', buyer_name: 'Beta', buyer_gstin: '24BBB', buyer_billing_json: '{"city":"Rajkot"}', buyer_shipping_json: '{}', hsn_code: '3902', amount: 84000, cgst: 7560, sgst: 7560, igst: 0, tcs: 0, roundoff: 0, total_invoice_amount: 99120, total_qty_kg: 1000, vehicle: 'By Van', eway_bill_no: null, eway_bill_date: null } as unknown as Sale
const allocs = [{ id: 1, sale_id: 1, purchase_id: 1, qty_drawn_kg: 1000, rate_per_kg: 84, line_amount: 84000 }] as SaleAllocation[]

describe('InvoiceTemplate', () => {
  it('renders seller, buyer, invoice number, and total', () => {
    render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} />)
    expect(screen.getByText('RP Plastics')).toBeTruthy()
    expect(screen.getByText(/RP\/008\/2024-25/)).toBeTruthy()
    expect(screen.getByText(/Beta/)).toBeTruthy()
    expect(screen.getByText(/99,120\.00/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test, verify it fails**

Run: `npx vitest run tests/renderer/invoice-template.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement template + css**

`src/renderer/invoice/invoice.css`:
```css
.invoice { background: #fff; color: #000; padding: 24px; max-width: 800px; margin: 0 auto; font-size: 14px; }
.invoice h2 { margin: 0; }
.invoice table { width: 100%; border-collapse: collapse; margin-top: 12px; }
.invoice th, .invoice td { border: 1px solid #000; padding: 6px 8px; }
.invoice .totals td { border: none; }
.invoice .head { display: flex; justify-content: space-between; }
@media print { .no-print { display: none; } body { background: #fff; } }
```

`src/renderer/invoice/InvoiceTemplate.tsx`:
```tsx
import type { Sale, SaleAllocation, Settings } from '@shared/types'
import { formatINR } from '../lib/format'
import './invoice.css'

function addr(json: string): string {
  try { const o = JSON.parse(json); return [o.address, o.city, o.state, o.pincode].filter(Boolean).join(', ') } catch { return '' }
}

export default function InvoiceTemplate({ sale, allocations, settings }: { sale: Sale; allocations: SaleAllocation[]; settings: Settings }) {
  const interState = sale.igst > 0
  return (
    <div className="invoice">
      <div className="head">
        <div><h2>{settings.seller_name}</h2><div>{settings.seller_address}</div>
          <div>GSTIN: {settings.seller_gstin} · PAN: {settings.seller_pan}</div></div>
        <div style={{ textAlign: 'right' }}><b>TAX INVOICE</b><div>{sale.invoice_number}</div><div>{sale.invoice_date}</div></div>
      </div>
      <table>
        <tbody>
          <tr><td><b>Buyer:</b> {sale.buyer_name}<br />{addr(sale.buyer_billing_json)}<br />GSTIN: {sale.buyer_gstin}</td>
            <td><b>Ship to:</b><br />{addr(sale.buyer_shipping_json) || addr(sale.buyer_billing_json)}</td></tr>
        </tbody>
      </table>
      {(sale.eway_bill_no || sale.vehicle) &&
        <p>{sale.eway_bill_no ? `E-way bill: ${sale.eway_bill_no} (${sale.eway_bill_date ?? ''})` : ''} {sale.vehicle ? `· Vehicle: ${sale.vehicle}` : ''}</p>}
      <table>
        <thead><tr><th>#</th><th>HSN</th><th>Qty (kg)</th><th>Rate/kg</th><th>Amount</th></tr></thead>
        <tbody>{allocations.map((a, i) => (
          <tr key={a.id}><td>{i + 1}</td><td>{sale.hsn_code}</td><td>{a.qty_drawn_kg}</td><td>{formatINR(a.rate_per_kg)}</td><td>{formatINR(a.line_amount)}</td></tr>
        ))}</tbody>
      </table>
      <table className="totals" style={{ marginTop: 8 }}>
        <tbody>
          <tr><td style={{ textAlign: 'right' }}>Taxable value</td><td style={{ textAlign: 'right' }}>{formatINR(sale.amount)}</td></tr>
          {interState
            ? <tr><td style={{ textAlign: 'right' }}>IGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.igst)}</td></tr>
            : <><tr><td style={{ textAlign: 'right' }}>CGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.cgst)}</td></tr>
              <tr><td style={{ textAlign: 'right' }}>SGST</td><td style={{ textAlign: 'right' }}>{formatINR(sale.sgst)}</td></tr></>}
          {sale.tcs ? <tr><td style={{ textAlign: 'right' }}>TCS</td><td style={{ textAlign: 'right' }}>{formatINR(sale.tcs)}</td></tr> : null}
          {sale.roundoff ? <tr><td style={{ textAlign: 'right' }}>Round off</td><td style={{ textAlign: 'right' }}>{formatINR(sale.roundoff)}</td></tr> : null}
          <tr><td style={{ textAlign: 'right' }}><b>Total</b></td><td style={{ textAlign: 'right' }}><b>{formatINR(sale.total_invoice_amount)}</b></td></tr>
        </tbody>
      </table>
    </div>
  )
}
```

`src/renderer/screens/InvoiceView.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import type { Sale, SaleAllocation, Settings } from '@shared/types'
import InvoiceTemplate from '../invoice/InvoiceTemplate'

export default function InvoiceView() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState<{ sale: Sale; allocations: SaleAllocation[] } | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => { (async () => {
    if (id) setData(await window.api.getSaleWithAllocations(Number(id)))
    setSettings(await window.api.getSettings())
  })() }, [id])
  if (!data || !settings) return <div className="content">Loading…</div>
  return (
    <div>
      <div className="no-print" style={{ padding: 16 }}>
        <button className="primary" onClick={() => window.print()}>Print / Save as PDF</button>{' '}
        <button onClick={() => nav('/sales')}>Back to sales</button>
      </div>
      <InvoiceTemplate sale={data.sale} allocations={data.allocations} settings={settings} />
    </div>
  )
}
```

- [ ] **Step 4: Wire the route + NewSale navigation**

In `src/renderer/routes.tsx` add the import `import InvoiceView from './screens/InvoiceView'` and the route `<Route path="/invoice/:id" element={<InvoiceView />} />`.
In `src/renderer/screens/NewSale.tsx` change the success branch to: `if (thenInvoice) nav(\`/invoice/${sale.id}\`)`.

- [ ] **Step 5: Run test + verify in app**

Run: `npx vitest run tests/renderer/invoice-template.test.tsx`
Expected: PASS.
Run: `npm run dev` → create a sale with **Save & generate invoice PDF** → the invoice view opens; **Print / Save as PDF** opens Chromium's dialog with a "Save as PDF" destination; the printed page hides the buttons (`@media print`).

- [ ] **Step 6: Commit**

```bash
git add src/renderer/invoice src/renderer/screens/InvoiceView.tsx src/renderer/routes.tsx src/renderer/screens/NewSale.tsx tests/renderer/invoice-template.test.tsx
git commit -m "feat: swappable GST invoice template + print/PDF view"
```

---

### Task 23: End-to-end integration test (sale → stock → invoice)

**Files:**
- Test: `tests/integration/sale-to-invoice.test.tsx`

**Interfaces:**
- Consumes: core (`openDatabase`, `createPurchase`, `createSale`, `getSale`, `getAllocations`, `getPurchase`, `saveSettings`) + `InvoiceTemplate`. Verifies the spec §9 flow: create sale → stock decremented → invoice renders the right total.

- [ ] **Step 1: Write the test**

`tests/integration/sale-to-invoice.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { openDatabase } from '../../src/main/db/connection'
import { saveSettings, getSettings } from '../../src/main/core/reference'
import { createPurchase, getPurchase } from '../../src/main/core/purchase'
import { createSale, getSale, getAllocations } from '../../src/main/core/sale'
import InvoiceTemplate from '../../src/renderer/invoice/InvoiceTemplate'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:'); saveSettings(db, { home_state: 'Gujarat', seller_name: 'RP Plastics', invoice_prefix: 'RP' }) })

describe('sale → stock → invoice', () => {
  it('decrements stock and renders an invoice total', () => {
    const lot = createPurchase(db, { our_code: '0001/2425', supplier_invoice_number: 'S1', invoice_date: '2024-05-01',
      party: 'Acme', party_state: 'Gujarat', hsn_code: '3902', qty_kg: 1000, amount: 50000, gst_rate: 18, homeState: 'Gujarat' })

    const sale = createSale(db, { invoice_number: 'RP/008/2024-25', invoice_date: '2024-05-10',
      buyer_customer_id: null, buyer_name: 'Beta', buyer_gstin: '24BBB',
      buyer_billing: { city: 'Rajkot', state: 'Gujarat' }, buyer_shipping: { city: 'Rajkot', state: 'Gujarat' },
      place_of_supply_state: 'Gujarat', homeState: 'Gujarat', hsn_code: '3902', gst_rate: 18,
      lines: [{ purchase_id: lot.id, qty_drawn_kg: 1000, rate_per_kg: 84 }] })

    expect(getPurchase(db, lot.id)!.qty_remaining_kg).toBe(0)
    expect(sale.amount).toBe(84000)
    expect(sale.total_invoice_amount).toBe(99120)   // 84000 + 7560 + 7560

    render(<InvoiceTemplate sale={getSale(db, sale.id)} allocations={getAllocations(db, sale.id)} settings={getSettings(db)} />)
    expect(screen.getByText(/RP\/008\/2024-25/)).toBeTruthy()
    expect(screen.getByText(/99,120\.00/)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run it, verify it passes**

Run: `npx vitest run tests/integration/sale-to-invoice.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/integration/sale-to-invoice.test.tsx
git commit -m "test: end-to-end sale -> stock -> invoice integration"
```

---

### Task 24: One-time Excel migration script (stub + contract)

**Files:**
- Create: `scripts/migrate-excel.ts`, `scripts/README.md`

**Interfaces:**
- A standalone Node script the owner runs once on their own machine (Spec §10). It is NOT wired into the app. v1 ships the runnable skeleton: it opens a target db, reads `.xlsx` paths from argv, and calls the same core functions (`createPurchase`, `createCustomer`, `createSale`). Parsing of the owner's exact sheet columns is filled in once a real (dummy-data) sheet is available — the script logs and exits if no parser is configured, so it never silently imports nothing.

- [ ] **Step 1: Implement the skeleton**

`scripts/migrate-excel.ts`:
```ts
/**
 * One-time importer. Run on the owner's machine only. Not part of the app build.
 * Usage: node --loader ts-node/esm scripts/migrate-excel.ts <data.db> <workbook.xlsx>
 * Requires (dev-only, install when running): `npm i -D xlsx ts-node`
 */
import { openDatabase } from '../src/main/db/connection'

function main(): void {
  const [dbPath, workbook] = process.argv.slice(2)
  if (!dbPath || !workbook) {
    console.error('Usage: migrate-excel <data.db> <workbook.xlsx>')
    process.exit(1)
  }
  const db = openDatabase(dbPath)
  console.error(
    'No sheet parser configured yet. Provide a sample workbook (dummy data) so the ' +
    'column mapping for purchases/customers/sales can be implemented here. Aborting without changes.'
  )
  db.close()
  process.exit(2)
}

main()
```

`scripts/README.md`:
```md
# One-time Excel migration

This script imports historical data **once** into a Granule Trader `.db` file.
It runs locally on the owner's machine and is not bundled into the app.

1. `npm i -D xlsx ts-node`
2. Close Granule Trader (release the data lock).
3. `node --loader ts-node/esm scripts/migrate-excel.ts /path/to/granule-trader.db /path/to/old-data.xlsx`

The column mapping is implemented once a sample workbook (with dummy data) is supplied.
All data stays on the local machine; no business data is shared elsewhere.
```

- [ ] **Step 2: Verify it runs and refuses safely**

Run: `npm i -D ts-node xlsx && node --loader ts-node/esm scripts/migrate-excel.ts /tmp/x.db /tmp/x.xlsx; echo "exit=$?"`
Expected: prints the "No sheet parser configured" message and `exit=2` (no rows imported).

- [ ] **Step 3: Commit**

```bash
git add scripts/migrate-excel.ts scripts/README.md
git commit -m "chore: one-time Excel migration skeleton (parser pending sample)"
```

---

### Task 25: Full-suite verification

- [ ] **Step 1: Run everything**

Run: `npm test && npm run typecheck`
Expected: all tests green; no type errors.

- [ ] **Step 2: Production build smoke**

Run: `npm run build`
Expected: build completes for main, preload, renderer with no errors.

- [ ] **Step 3: Manual end-to-end pass**

Run: `npm run dev`. Walk the full flow: first-run setup → add HSN in Settings → add a customer → record two purchases → create a sale drawing across both lots → confirm stock dropped on the Stock screen → generate the invoice PDF → reserve a gap by jumping the invoice number → Fill it from the register → record a stock adjustment → check the Dashboard KPIs.

- [ ] **Step 4: Commit any final fixes**

```bash
git add -A && git commit -m "chore: full-suite verification pass" --allow-empty
```

---

## Notes for the implementer

- **`@shared/*` alias** is configured in `tsconfig.json`, `electron.vite.config.ts`, and `vitest.config.ts`. Core tests import core files by relative path; only renderer code uses `@shared`.
- **Pure helpers imported into the renderer** (`placeOfSupplyState` from `core/customers`, types from `core/purchase`/`core/sale`) are safe: their only non-type dependency is erased at build time (`import type Database`). Do not import a function that touches the DB into the renderer.
- **Rounding:** every monetary write goes through `round2`; the renderer mirrors the same formula for live previews but the **stored** values always come from the core functions (single source of truth).
- **Reserved rows** carry `invoice_date = NULL`; never show them a total — the register renders them as blank with a Fill action.
