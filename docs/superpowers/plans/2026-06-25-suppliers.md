# Suppliers Entity + Purchase Supplier Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make suppliers a master entity (like customers) with full CRUD + their own screen, and make a purchase reference a saved supplier via a searchable picker that prefills the supplier's details read-only and snapshots them onto the purchase.

**Architecture:** Add a `suppliers` table + `src/main/core/suppliers.ts` (mirror of `customers.ts`, single address), wire it through types → `Api`/`CHANNELS` → IPC (preload is `CHANNELS`-driven). Add Suppliers list/form screens, routes, and a nav item. Add a nullable `supplier_id` FK on `purchases` (mirrors `buyer_customer_id`); the purchase form picks a supplier and snapshots its details into the existing `party*` columns.

**Tech Stack:** Electron + electron-vite, React 18, TypeScript, Mantine v7, better-sqlite3, Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-suppliers-design.md` is authoritative.
- **Supplier = single-address master.** Fields: `name, gstin, pan, phone, address, city, state, pincode`. GSTIN mandatory; **PAN auto-derived read-only** via `panFromGstin`; phone mandatory (10-digit); name/state/city/pincode/address required (pincode 6-digit).
- **`supplier_id` on `purchases` is a nullable FK** `INTEGER REFERENCES suppliers(id)` (foreign keys are enforced — no `NOT NULL DEFAULT 0` sentinel). "Supplier required" is enforced in the form, like the buyer on a sale.
- **Snapshot on save:** the purchase stores `supplier_id` AND copies the supplier's details into `party, party_state, party_city, party_pincode, party_address`. Tax/numbering/draw-down logic is unchanged (tax still reads `party_state`).
- **Dev phase:** the DB may be reset; no legacy-data handling required. Schema adds the column to `CREATE TABLE` for fresh DBs plus an idempotent `ALTER` for safety.
- Renderer reaches data only via `window.api.*`. Build stays green each task (`npm test` + `npm run typecheck` + `npm run build`). Do NOT run `npm run dev` headless.

---

## File Structure

**Create:**
- `src/main/core/suppliers.ts` — supplier CRUD.
- `tests/core/suppliers.test.ts` — supplier core tests.
- `src/renderer/screens/Suppliers.tsx` — list screen.
- `src/renderer/screens/SupplierForm.tsx` — add/edit form.

**Modify:**
- `src/main/db/schema.ts` — `suppliers` table + `supplier_id` column (+ idempotent ALTER).
- `tests/db/schema.test.ts` — assert `suppliers` table + `purchases.supplier_id`.
- `src/shared/types.ts` — `Supplier` interface; `Purchase.supplier_id`.
- `src/shared/api.ts` — 4 supplier methods + channels.
- `tests/core/api-shape.test.ts` — list the 4 new channels.
- `src/main/ipc.ts` — 4 supplier handlers.
- `src/main/core/purchase.ts` — `NewPurchase.supplier_id`; persist it on create/update.
- `tests/core/purchase.test.ts` — supplier_id round-trip.
- `src/renderer/routes.tsx` — supplier routes.
- `src/renderer/components/Sidebar.tsx` — Suppliers nav item.
- `tests/renderer/sidebar.test.tsx` — expect Suppliers.
- `src/renderer/screens/PurchaseForm.tsx` — supplier picker + read-only block + snapshot.

---

## Task 1: Suppliers table + type + core module

**Files:**
- Modify: `src/main/db/schema.ts`, `src/shared/types.ts`, `tests/db/schema.test.ts`
- Create: `src/main/core/suppliers.ts`, `tests/core/suppliers.test.ts`

**Interfaces:**
- Produces (consumed by Tasks 2/4/5):
  - `interface Supplier { id: number; name: string; gstin: string; pan: string; phone: string; address: string; city: string; state: string; pincode: string }`
  - `Purchase` gains `supplier_id: number | null`
  - `createSupplier(db, s: Omit<Supplier,'id'>): Supplier`, `updateSupplier(db, id: number, s: Omit<Supplier,'id'>): Supplier`, `getSupplier(db, id: number): Supplier | undefined`, `listSuppliers(db, search?: string): Supplier[]`, `deleteSupplier(db, id: number): void`

- [ ] **Step 1: Add the `Supplier` type and `Purchase.supplier_id`** (`src/shared/types.ts`)

After the `Customer` interface, add:

```ts
export interface Supplier {
  id: number
  name: string
  gstin: string
  pan: string
  phone: string
  address: string
  city: string
  state: string
  pincode: string
}
```

In the `Purchase` interface, add this field (next to the other ids, e.g. after `created_at` or near `party`):

```ts
  supplier_id: number | null
```

- [ ] **Step 2: Add the `suppliers` table + `purchases.supplier_id`** (`src/main/db/schema.ts`)

(a) In `SCHEMA_SQL`, add a new table (place it right after the `customers` table block):

```sql
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  gstin TEXT NOT NULL DEFAULT '',
  pan TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  pincode TEXT NOT NULL DEFAULT ''
);
```

(b) In the `CREATE TABLE IF NOT EXISTS purchases (...)` block, add the column (e.g. right after `party_address ...`):

```sql
  supplier_id INTEGER REFERENCES suppliers(id),
```

(c) In `migrate()`, extend the `purchases` ALTER loop so it also adds `supplier_id` for any existing dev DB. Change the array to include the new column:

```ts
  for (const [col, ddl] of [
    ['rate_per_kg', `ALTER TABLE purchases ADD COLUMN rate_per_kg REAL NOT NULL DEFAULT 0`],
    ['party_city', `ALTER TABLE purchases ADD COLUMN party_city TEXT NOT NULL DEFAULT ''`],
    ['party_pincode', `ALTER TABLE purchases ADD COLUMN party_pincode TEXT NOT NULL DEFAULT ''`],
    ['party_address', `ALTER TABLE purchases ADD COLUMN party_address TEXT NOT NULL DEFAULT ''`],
    ['supplier_id', `ALTER TABLE purchases ADD COLUMN supplier_id INTEGER REFERENCES suppliers(id)`]
  ] as const) {
    if (!hasColumn(db, 'purchases', col)) db.exec(ddl)
  }
```

(Note: SQLite allows `ADD COLUMN ... REFERENCES` only when the column is nullable with no default, which is the case here.)

- [ ] **Step 3: Write the failing schema test** (append to `tests/db/schema.test.ts`, inside the `describe('schema', …)`)

```ts
  it('creates the suppliers table and a supplier_id column on purchases', () => {
    const db = openDatabase(':memory:')
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r: any) => r.name)
    expect(tables).toContain('suppliers')
    const cols = db.prepare("PRAGMA table_info(purchases)").all().map((r: any) => r.name)
    expect(cols).toContain('supplier_id')
    db.close()
  })
```

Also add `'suppliers'` to the table list asserted by the existing `creates all core tables` test:

```ts
    for (const t of ['customers','hsn_products','purchases','sale_allocations','sales','settings','stock_adjustments','suppliers'])
```

- [ ] **Step 4: Write the failing core test** (create `tests/core/suppliers.test.ts`)

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { openDatabase } from '../../src/main/db/connection'
import { createSupplier, updateSupplier, getSupplier, listSuppliers, deleteSupplier } from '../../src/main/core/suppliers'

let db: ReturnType<typeof openDatabase>
beforeEach(() => { db = openDatabase(':memory:') })

const s = {
  name: 'Acme Polymers', gstin: '24CCGPC8555A1Z5', pan: 'CCGPC8555A', phone: '9876543210',
  address: '1 Industrial Estate', city: 'Surat', state: 'Gujarat', pincode: '395003'
}

describe('suppliers', () => {
  it('creates and reads back every field', () => {
    const saved = createSupplier(db, s)
    expect(saved.id).toBeGreaterThan(0)
    expect(getSupplier(db, saved.id)).toMatchObject(s)
  })
  it('lists ordered by name and filters by name or gstin', () => {
    createSupplier(db, { ...s, name: 'Zeta Plast', gstin: '24ZZZPZ0000Z1Z5' })
    createSupplier(db, s)
    expect(listSuppliers(db).map(x => x.name)).toEqual(['Acme Polymers', 'Zeta Plast'])
    expect(listSuppliers(db, 'acme')).toHaveLength(1)
    expect(listSuppliers(db, 'ZZZPZ')).toHaveLength(1)
    expect(listSuppliers(db, 'nope')).toHaveLength(0)
  })
  it('updates an existing supplier', () => {
    const saved = createSupplier(db, s)
    updateSupplier(db, saved.id, { ...s, city: 'Vapi' })
    expect(getSupplier(db, saved.id)!.city).toBe('Vapi')
  })
  it('deletes a supplier', () => {
    const saved = createSupplier(db, s)
    deleteSupplier(db, saved.id)
    expect(getSupplier(db, saved.id)).toBeUndefined()
  })
})
```

- [ ] **Step 5: Run the failing tests, verify they fail**

Run: `npx vitest run tests/core/suppliers.test.ts tests/db/schema.test.ts`
Expected: FAIL — `src/main/core/suppliers` not found (core test) and the new schema assertions fail until Step 2 is in place. (Step 2 may already make the schema test pass; the core test must fail.)

- [ ] **Step 6: Implement the core module** (create `src/main/core/suppliers.ts`)

```ts
import type Database from 'better-sqlite3'
import type { Supplier } from '@shared/types'

const COLS = `name, gstin, pan, phone, address, city, state, pincode`

export function createSupplier(db: Database.Database, s: Omit<Supplier, 'id'>): Supplier {
  const info = db.prepare(`INSERT INTO suppliers (${COLS}) VALUES
    (@name,@gstin,@pan,@phone,@address,@city,@state,@pincode)`).run(s)
  return getSupplier(db, Number(info.lastInsertRowid))!
}

export function updateSupplier(db: Database.Database, id: number, s: Omit<Supplier, 'id'>): Supplier {
  db.prepare(`UPDATE suppliers SET name=@name, gstin=@gstin, pan=@pan, phone=@phone,
    address=@address, city=@city, state=@state, pincode=@pincode WHERE id=@id`).run({ ...s, id })
  return getSupplier(db, id)!
}

export function getSupplier(db: Database.Database, id: number): Supplier | undefined {
  return db.prepare('SELECT * FROM suppliers WHERE id = ?').get(id) as Supplier | undefined
}

export function listSuppliers(db: Database.Database, search?: string): Supplier[] {
  return (search
    ? db.prepare(`SELECT * FROM suppliers WHERE name LIKE ? OR gstin LIKE ? ORDER BY name`).all(`%${search}%`, `%${search}%`)
    : db.prepare('SELECT * FROM suppliers ORDER BY name').all()) as Supplier[]
}

export function deleteSupplier(db: Database.Database, id: number): void {
  db.prepare('DELETE FROM suppliers WHERE id = ?').run(id)
}
```

- [ ] **Step 7: Run the tests, verify they pass**

Run: `npx vitest run tests/core/suppliers.test.ts tests/db/schema.test.ts`
Expected: PASS.

- [ ] **Step 8: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: green. (Adding `supplier_id: number | null` to `Purchase` may surface a type error wherever a `Purchase` literal is built — there should be none in non-test code yet; if `listPurchases` maps rows to `Purchase`, the column now exists so it is covered.)

- [ ] **Step 9: Commit**

```bash
git add src/main/db/schema.ts src/shared/types.ts src/main/core/suppliers.ts tests/core/suppliers.test.ts tests/db/schema.test.ts
git commit -m "feat: suppliers table + Supplier type + core CRUD; purchases.supplier_id column"
```

---

## Task 2: IPC + API surface for suppliers

**Files:**
- Modify: `src/shared/api.ts`, `src/main/ipc.ts`, `tests/core/api-shape.test.ts`

**Interfaces:**
- Consumes from Task 1: `listSuppliers/createSupplier/updateSupplier/deleteSupplier` and the `Supplier` type.
- Produces (consumed by Tasks 3/5): `window.api.listSuppliers/createSupplier/updateSupplier/deleteSupplier`.

- [ ] **Step 1: Add the API methods + channels** (`src/shared/api.ts`)

(a) Add `Supplier` to the type import from `./types`:

```ts
import type { Purchase, Customer, Supplier, Sale, SaleAllocation, HsnProduct, Settings, AvailableLot, LedgerRow } from './types'
```

(b) In the `Api` interface, after the `// customers` block, add:

```ts
  // suppliers
  listSuppliers(search?: string): Promise<Supplier[]>
  createSupplier(s: Omit<Supplier, 'id'>): Promise<Supplier>
  updateSupplier(id: number, s: Omit<Supplier, 'id'>): Promise<Supplier>
  deleteSupplier(id: number): Promise<void>
```

(c) In the `CHANNELS` array, add the four channel names (e.g. right after the customer channels):

```ts
  'listSuppliers','createSupplier','updateSupplier','deleteSupplier',
```

- [ ] **Step 2: Register the IPC handlers** (`src/main/ipc.ts`)

(a) Add the import near the customers import:

```ts
import { listSuppliers, createSupplier, updateSupplier, deleteSupplier } from './core/suppliers'
```

(b) After the customer `h(...)` block, add:

```ts
  h('listSuppliers', (search) => listSuppliers(db(), search))
  h('createSupplier', (s) => createSupplier(db(), s))
  h('updateSupplier', (id, s) => updateSupplier(db(), id, s))
  h('deleteSupplier', (id) => deleteSupplier(db(), id))
```

- [ ] **Step 3: Update the API-shape test** (`tests/core/api-shape.test.ts`)

Add the four method names to the `API_METHODS` array (after the customer methods):

```ts
  'listSuppliers','createSupplier','updateSupplier','deleteSupplier',
```

- [ ] **Step 4: Verify**

Run: `npm test && npm run typecheck`
Expected: green — `api-shape` test passes (every method has a channel); preload auto-bridges the new channels from `CHANNELS`.

- [ ] **Step 5: Commit**

```bash
git add src/shared/api.ts src/main/ipc.ts tests/core/api-shape.test.ts
git commit -m "feat: suppliers IPC + api surface (list/create/update/delete)"
```

---

## Task 3: Suppliers screens + routes + nav

**Files:**
- Create: `src/renderer/screens/Suppliers.tsx`, `src/renderer/screens/SupplierForm.tsx`
- Modify: `src/renderer/routes.tsx`, `src/renderer/components/Sidebar.tsx`, `tests/renderer/sidebar.test.tsx`

**Interfaces:**
- Consumes: `window.api.listSuppliers/createSupplier/updateSupplier/deleteSupplier`, the `Supplier` type, `panFromGstin/isGstin/isMobile/isPincode` from `@shared/validation`, the shared components `FormPage/FormSection/StateSelect/PincodeField/PageHeader/ListTable`, and **`@mantine/form`** (`useForm`, `isNotEmpty`).

**Sub-skill:** the implementer of this task MUST consult the `mantine-form` skill at
`/Users/shivamchoudhary/.agents/skills/mantine-form/SKILL.md` — the Suppliers form is
built with `@mantine/form` (`useForm` + `getInputProps` + validators), not the legacy
manual `errs`/`valid` pattern. (The existing forms keep the manual pattern for now; a
separate follow-up sub-project migrates them.)

- [ ] **Step 0: Install `@mantine/form`** (pinned to the Mantine version in use)

Run: `npm install @mantine/form@7.17.8`
Expected: it is added to `dependencies` (pure-JS package; no native rebuild). `npm test`
still green afterwards.

- [ ] **Step 1: Create the Suppliers list screen** (`src/renderer/screens/Suppliers.tsx`)

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, TextInput, Button, Alert, Group, Table } from '@mantine/core'
import type { Supplier } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'

export default function Suppliers() {
  const nav = useNavigate()
  const [list, setList] = useState<Supplier[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listSuppliers(search || undefined)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [search])
  async function remove(id: number) {
    if (!confirm('Delete this supplier?')) return
    try { await window.api.deleteSupplier(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Suppliers" action={<Button onClick={() => nav('/suppliers/new')}>+ Add supplier</Button>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <TextInput placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.currentTarget.value)} maw={380} mb="md" />
        <ListTable head={<><Table.Th>Name</Table.Th><Table.Th>GSTIN</Table.Th><Table.Th>City</Table.Th><Table.Th>State</Table.Th><Table.Th /></>}>
          {list.map(s => (
            <Table.Tr key={s.id}>
              <Table.Td>{s.name}</Table.Td><Table.Td>{s.gstin}</Table.Td><Table.Td>{s.city}</Table.Td><Table.Td>{s.state}</Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button variant="subtle" size="compact-sm" onClick={() => nav(`/suppliers/edit/${s.id}`)}>Edit</Button>
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => remove(s.id)}>Delete</Button>
                </Group>
              </Table.Td>
            </Table.Tr>))}
          {list.length === 0 && <Table.Tr><Table.Td colSpan={5} c="dimmed">No suppliers yet.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
```

- [ ] **Step 2: Create the Supplier form with `@mantine/form`** (`src/renderer/screens/SupplierForm.tsx`)

Built with `useForm` per the `mantine-form` skill. Notes: `FormPage` renders footer
buttons (not a `<form>` element), so Save is `onClick={form.onSubmit(handleSave)}` —
`onSubmit` validates and only calls the handler when valid, surfacing field errors
otherwise (no disabled-button gate needed). GSTIN's `onChange` is overridden after the
`getInputProps` spread so it can also set the derived read-only PAN. `PincodeField` and
`StateSelect` are custom components wired via `setFieldValue` + `form.errors`.

```tsx
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { TextInput, Textarea, Button, Input } from '@mantine/core'
import { useForm, isNotEmpty } from '@mantine/form'
import { notifications } from '@mantine/notifications'
import type { Supplier } from '@shared/types'
import { isGstin, isMobile, isPincode, panFromGstin } from '@shared/validation'
import FormPage from '../components/FormPage'
import FormSection from '../components/FormSection'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

const EMPTY: Omit<Supplier, 'id'> = {
  name: '', gstin: '', pan: '', phone: '', address: '', city: '', state: '', pincode: ''
}

export default function SupplierForm() {
  const nav = useNavigate()
  const { id } = useParams()
  const editId = id ? Number(id) : null
  const [error, setError] = useState('')

  const form = useForm<Omit<Supplier, 'id'>>({
    mode: 'controlled',
    initialValues: EMPTY,
    validateInputOnBlur: true,
    validate: {
      name: isNotEmpty('Required'),
      gstin: (v) => (isGstin(v) ? null : 'Invalid GSTIN (e.g. 24ABCDE1234F1Z5)'),
      phone: (v) => (isMobile(v) ? null : 'Enter a 10-digit phone number'),
      city: isNotEmpty('Required'),
      state: isNotEmpty('Required'),
      address: isNotEmpty('Required'),
      pincode: (v) => (isPincode(v) ? null : '6-digit pincode')
    }
  })

  useEffect(() => {
    if (!editId) return
    window.api.listSuppliers().then(all => {
      const s = all.find(x => x.id === editId)
      if (s) { const { id: _i, ...rest } = s; form.setValues(rest) }
    }).catch(e => setError(e.message ?? String(e)))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId])

  async function handleSave(values: Omit<Supplier, 'id'>) {
    setError('')
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      if (editId) await window.api.updateSupplier(editId, payload); else await window.api.createSupplier(payload)
      notifications.show({ message: 'Supplier saved', color: 'green' })
      nav('/suppliers')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <FormPage title={editId ? 'Edit supplier' : 'Add supplier'} onBack={() => nav('/suppliers')} error={error}
      footer={<>
        <Button variant="default" onClick={() => nav('/suppliers')}>Cancel</Button>
        <Button onClick={form.onSubmit(handleSave)}>Save supplier</Button>
      </>}>
      <FormSection title="Business details">
        <TextInput label="Name" withAsterisk {...form.getInputProps('name')} />
        <TextInput label="GSTIN" withAsterisk {...form.getInputProps('gstin')}
          onChange={e => {
            const v = e.currentTarget.value.toUpperCase()
            form.setFieldValue('gstin', v)
            form.setFieldValue('pan', panFromGstin(v))
          }} />
        <TextInput label="PAN (from GSTIN)" disabled value={form.values.pan} />
        <TextInput label="Phone" withAsterisk {...form.getInputProps('phone')}
          onChange={e => form.setFieldValue('phone', e.currentTarget.value.replace(/\D/g, '').slice(0, 10))} />
      </FormSection>
      <FormSection title="Address">
        <Input.Wrapper label="Pincode" error={form.errors.pincode}>
          <PincodeField value={form.values.pincode} onChange={v => form.setFieldValue('pincode', v)}
            onResolved={r => { form.setFieldValue('city', r.city); form.setFieldValue('state', r.state) }} />
        </Input.Wrapper>
        <TextInput label="City" {...form.getInputProps('city')} />
        <Input.Wrapper label="State" error={form.errors.state}>
          <StateSelect value={form.values.state} onChange={v => form.setFieldValue('state', v)} />
        </Input.Wrapper>
        <Textarea label="Address" autosize minRows={2} {...form.getInputProps('address')} />
      </FormSection>
    </FormPage>
  )
}
```

- [ ] **Step 3: Add the routes** (`src/renderer/routes.tsx`)

(a) Add imports:

```tsx
import Suppliers from './screens/Suppliers'
import SupplierForm from './screens/SupplierForm'
```

(b) Add three routes (after the customers routes):

```tsx
      <Route path="/suppliers" element={<Suppliers />} />
      <Route path="/suppliers/new" element={<SupplierForm />} />
      <Route path="/suppliers/edit/:id" element={<SupplierForm />} />
```

- [ ] **Step 4: Add the nav item** (`src/renderer/components/Sidebar.tsx`)

(a) Add `IconBuildingWarehouse` to the `@tabler/icons-react` import:

```tsx
import { IconDashboard, IconShoppingCart, IconReceipt, IconBox, IconUsers, IconBuildingWarehouse, IconSettings } from '@tabler/icons-react'
```

(b) Add the item to the `items` array, after Customers:

```tsx
  { to: '/suppliers', label: 'Suppliers', icon: IconBuildingWarehouse },
```

- [ ] **Step 5: Update the sidebar test** (`tests/renderer/sidebar.test.tsx`)

Change the test name/count and add `'Suppliers'` to the expected labels:

```tsx
  it('shows all seven navigation items', () => {
    renderWithMantine(<HashRouter><Sidebar /></HashRouter>)
    for (const label of ['Dashboard','Purchases','Sales','Stock','Customers','Suppliers','Settings'])
      expect(screen.getByText(label)).toBeTruthy()
  })
```

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green. Manual check (deferred to operator): a Suppliers nav item opens the list; "+ Add supplier" opens the form; typing a GSTIN fills the greyed PAN; Save is blocked until name/GSTIN/phone/city/state/pincode/address are valid; the saved supplier appears in the list and is searchable.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/renderer/screens/Suppliers.tsx src/renderer/screens/SupplierForm.tsx src/renderer/routes.tsx src/renderer/components/Sidebar.tsx tests/renderer/sidebar.test.tsx
git commit -m "feat: Suppliers list + form (@mantine/form) screens, route, and nav item"
```

---

## Task 4: Persist supplier_id on purchases (core)

**Files:**
- Modify: `src/main/core/purchase.ts`
- Test: `tests/core/purchase.test.ts`

**Interfaces:**
- Consumes from Task 1: `suppliers` table, `createSupplier`, the `supplier_id` column.
- Produces (consumed by Task 5): `NewPurchase` gains `supplier_id?: number | null`; `createPurchase`/`updatePurchase` persist it; `listPurchases` returns it on each `Purchase`.

- [ ] **Step 1: Write the failing test** (append to `tests/core/purchase.test.ts`)

```ts
import { createSupplier } from '../../src/main/core/suppliers'

describe('purchase supplier link', () => {
  it('stores and returns supplier_id', () => {
    const sup = createSupplier(db, {
      name: 'Acme Polymers', gstin: '24CCGPC8555A1Z5', pan: 'CCGPC8555A', phone: '9876543210',
      address: '1 Estate', city: 'Surat', state: 'Gujarat', pincode: '395003'
    })
    const p = createPurchase(db, { ...base, our_code: '0001/2425', invoice_date: '2024-05-01', supplier_id: sup.id })
    expect(p.supplier_id).toBe(sup.id)
    expect(listPurchases(db)[0].supplier_id).toBe(sup.id)
  })
  it('defaults supplier_id to null when omitted', () => {
    const p = createPurchase(db, { ...base, our_code: '0002/2425', invoice_date: '2024-05-01' })
    expect(p.supplier_id).toBeNull()
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/core/purchase.test.ts`
Expected: FAIL — `supplier_id` not accepted by `NewPurchase` (type error) / not returned (`undefined`/missing).

- [ ] **Step 3: Add `supplier_id` to `NewPurchase` and persist it** (`src/main/core/purchase.ts`)

(a) Add the field to the `NewPurchase` interface:

```ts
  supplier_id?: number | null
```

(b) In `createPurchase`'s INSERT, add `supplier_id` to the column list, the `VALUES` list, and the bound params. In the column list add `supplier_id`, in VALUES add `@supplier_id`, and in the `.run({...})` object add:

```ts
    supplier_id: input.supplier_id ?? null,
```

(c) In `updatePurchase`'s UPDATE statement, add `supplier_id=@supplier_id` to the SET clause and `supplier_id: input.supplier_id ?? null` to the bound params.

(Read the current INSERT/UPDATE in `purchase.ts` and insert the column consistently with the existing `@party_address` etc. placeholders. `listPurchases` is `SELECT *`, so `supplier_id` is returned automatically once the column exists.)

- [ ] **Step 4: Run the test, verify it passes**

Run: `npx vitest run tests/core/purchase.test.ts`
Expected: PASS (including the existing purchase tests, which omit `supplier_id` → stored as `null`).

- [ ] **Step 5: Full suite + typecheck**

Run: `npm test && npm run typecheck`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add src/main/core/purchase.ts tests/core/purchase.test.ts
git commit -m "feat: persist purchases.supplier_id in create/update"
```

---

## Task 5: Purchase form — supplier picker + read-only prefill + snapshot

**Files:**
- Modify: `src/renderer/screens/PurchaseForm.tsx`
- Test: none (verify via typecheck + suite + build; core covered by Task 4)

**Interfaces:**
- Consumes: `window.api.listSuppliers`, the `Supplier` type, Task 4's `NewPurchase.supplier_id`. Existing `PurchaseForm` already imports `Select`, `Textarea`, `FormSection`, etc.

Context — current `PurchaseForm.tsx` facts:
- `form` state (lines ~24-29) holds `party, party_state, party_city, party_pincode, party_address` (free text) plus the invoice/amount fields. There is no `supplier_id`.
- The "Supplier" `FormSection` (lines ~104-115) renders free-text `Supplier name`, a `PincodeField`, `City`, `StateSelect`, and a `Textarea` address.
- Tax preview uses `form.party_state` (line ~56); `errs` (lines ~65-74) has `party` + `party_state` required.
- `save()` (lines ~77-91) builds a `payload` with the `party*` fields and calls `createPurchase`/`updatePurchase`.
- Edit-load (lines ~36-44) copies `p.party*` from the existing purchase into `form`.

- [ ] **Step 1: Load suppliers + add `supplier_id` to form state**

(a) Add a suppliers state and load it in the existing `useEffect` that loads settings/hsn (around line 33-35):

```tsx
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
```

In the loader, alongside `setSettings(...)` and `setHsn(...)`:

```tsx
      setSuppliers(await window.api.listSuppliers())
```

(b) Add `supplier_id` to the `form` initial state (in the `useState({...})` object):

```tsx
    supplier_id: null as number | null,
```

(c) Add the `Supplier` type to the type import at the top:

```tsx
import type { HsnProduct, Settings, Supplier } from '@shared/types'
```

(d) On edit-load (the `if (p) setForm({...})` block), include `supplier_id: p.supplier_id` so the picker preselects.

- [ ] **Step 2: Derive the selected supplier and use its state for tax**

After `const set = ...` (or near the other derivations), add:

```tsx
  const supplier = suppliers.find(s => s.id === form.supplier_id) ?? null
```

Change the tax/`gstRate` derivation and `errs` to use the supplier's state. Replace the `party_state` usages: the tax `placeOfSupplyState` should be `supplier?.state ?? ''`. Specifically, set `tax = computeTax({ ..., placeOfSupplyState: supplier?.state ?? '', ... })`.

- [ ] **Step 3: Replace the Supplier section with a picker + read-only details**

Replace the entire `<FormSection title="Supplier"> ... </FormSection>` block (lines ~104-115) with:

```tsx
      <FormSection title="Supplier">
        <Select
          label="Supplier"
          withAsterisk
          searchable
          placeholder="Type a supplier name…"
          data={suppliers.map(s => ({ value: String(s.id), label: s.name + (s.gstin ? ` (${s.gstin})` : '') }))}
          value={form.supplier_id ? String(form.supplier_id) : null}
          onChange={v => set({ supplier_id: v ? Number(v) : null })}
          error={errs.supplier_id}
        />
        {supplier && (
          <Paper withBorder p="sm" radius="sm" bg="var(--mantine-color-gray-0)">
            <Text size="sm">GSTIN: <Text component="span" fw={600}>{supplier.gstin || '—'}</Text></Text>
            <Text size="sm">Phone: {supplier.phone || '—'}</Text>
            <Text size="sm">
              Address: {[supplier.address, supplier.city, supplier.state].filter(Boolean).join(', ')}
              {supplier.pincode ? ` — ${supplier.pincode}` : ''}
            </Text>
            <Text size="xs" c="dimmed" mt={4}>To edit these, open the Suppliers screen.</Text>
          </Paper>
        )}
      </FormSection>
```

Add `Paper` and `Text` to the `@mantine/core` import at the top of the file:

```tsx
import { TextInput, Select, Input, Button, Textarea, Paper, Text } from '@mantine/core'
```

- [ ] **Step 4: Update validation — supplier required (drop party/party_state text rules)**

In the `errs` object, replace the `party` and `party_state` entries with a single supplier rule:

```tsx
    supplier_id: form.supplier_id ? '' : 'Choose a supplier',
```

(Remove the old `party:` and `party_state:` lines. The remaining rules — `our_code`, `invoice_date`, `hsn_code`, `qty_kg`, `rate_per_kg`, `party_pincode` — stay, except remove `party_pincode` too since the pincode field is gone; the supplier's pincode is trusted. Keep `our_code`, `invoice_date`, `hsn_code`, `qty_kg`, `rate_per_kg`, `supplier_id`.)

- [ ] **Step 5: Snapshot the supplier into the payload on save**

In `save()`, build the `party*` snapshot from the selected supplier. Replace the `party*` fields in the `payload` with values from `supplier` and add `supplier_id`:

```tsx
      const payload = {
        our_code: form.our_code, supplier_invoice_number: form.supplier_invoice_number, invoice_date: form.invoice_date,
        supplier_id: form.supplier_id,
        party: supplier?.name ?? '', party_state: supplier?.state ?? '',
        party_city: supplier?.city ?? '', party_pincode: supplier?.pincode ?? '', party_address: supplier?.address ?? '',
        hsn_code: form.hsn_code, qty_kg: form.qty_kg, rate_per_kg: form.rate_per_kg,
        gst_rate: gstRate, homeState: settings!.home_state, roundoff: form.roundoff, tcs: form.tcs,
        payment_status: form.payment_status, payment_date: form.payment_status === 'done' ? (form.payment_date || today()) : null
      }
```

Remove the now-unused `party*` keys from the `form` state object and the edit-loader's `party*` copies **only if** they are no longer referenced — simpler and safer is to keep `party*` in `form` unused; but since Step 1(d) sets `supplier_id` on edit and the picker drives everything, drop the `party*` fields from `form`'s initial state and the edit-loader to avoid dead state. (If TypeScript complains about a removed key still referenced, restore it; the goal is no unused free-text party state.)

Also remove the now-unused imports if they become dead: `isPincode` (if `party_pincode` validation is gone), `PincodeField`, `StateSelect` — check usage; `StateSelect`/`PincodeField` are no longer used in this file after the Supplier section is replaced, so remove their imports. Keep `Textarea` only if still used elsewhere in the file (it is not, after removal — remove it too).

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: all green (no unused-import or unused-var errors). Manual check (deferred to operator): the purchase form shows a single "Supplier" search box; typing a name suggests saved suppliers; picking one shows their GSTIN/phone/address read-only and drives intra/inter-state tax; Save is blocked until a supplier is chosen; saving stores the snapshot + `supplier_id`; editing a purchase preselects its supplier.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/screens/PurchaseForm.tsx
git commit -m "feat: purchase form — searchable supplier picker with read-only prefill + snapshot"
```

---

## Notes for the implementer

- **Foreign keys are ON.** `supplier_id` is nullable; never insert a sentinel `0`. Deleting a supplier referenced by a purchase will raise a SQLite FK error (acceptable — mirrors customers/sales; no special guard required).
- **Snapshot, not join:** the purchase's `party*` columns are the historical record; the live supplier is only used to fill them at save time and to display read-only details. Do not change how invoices/registers read `party`.
- Mantine `Select searchable` is the auto-suggest-by-name control (same as the sale's Buyer picker).
- Do not change tax math, numbering, or stock draw-down. The supplier's `state` simply replaces the old free-text `party_state` as the place-of-supply input to `computeTax`.
- The DB can be reset during development; no data preservation is required.
- **`@mantine/form` adoption:** the Suppliers form (Task 3) uses `@mantine/form` per the
  `mantine-form` skill. The existing forms (CustomerForm, PurchaseForm, FirstRun,
  Settings) keep their manual `errs`/`valid` pattern in this sub-project; migrating them
  to `@mantine/form` is a parked follow-up sub-project (E), so a transient mix of styles
  is expected and intended. Task 5's PurchaseForm change stays on the manual pattern.
