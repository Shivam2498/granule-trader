# HSN Product Edit & Delete Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user edit and delete HSN products from Settings, instead of only being able to blind-add them.

**Architecture:** `upsertHsn` already updates by primary key, so editing needs no new backend code — the UI just has to reach an existing row and lock its code. Delete is new and guarded: an HSN code referenced by any purchase or sale allocation cannot be removed. The Products section moves out of `Settings.tsx` into a self-contained `HsnEditor` component that owns its own `window.api` calls, so it can be tested without mounting the whole Settings form.

**Tech Stack:** Electron, React 18, Mantine 7, better-sqlite3, Vitest + Testing Library.

## Global Constraints

- Error messages are plain English aimed at a non-technical user (no SQL terms, no error codes). Match the tone of existing messages in `src/main/core/sale.ts`.
- Renderer never touches SQLite; all data access goes through `window.api` (typed in `src/shared/api.ts`).
- Every new IPC method must appear in **three** places or the guard test fails: the `Api` interface, the `CHANNELS` array (both `src/shared/api.ts`), and `API_METHODS` in `tests/core/api-shape.test.ts`.
- GST rates are snapshotted onto `sale_allocations` at sale time. Editing a rate must NOT attempt to rewrite historical sales.
- Refreshing the HSN list must never call Settings' `reload()` — that resets the Business form and discards unsaved edits (see the comment at `src/renderer/screens/Settings.tsx:67`).

---

### Task 1: `deleteHsn` with a reference guard

**Files:**
- Modify: `src/main/core/reference.ts` (append after `upsertHsn`)
- Test: `tests/core/reference.test.ts` (extend the existing `describe('hsn')` block)

**Interfaces:**
- Consumes: `openDatabase` from `src/main/db/connection`, `upsertHsn` from `src/main/core/reference`.
- Produces: `deleteHsn(db: Database.Database, code: string): void` — throws `Error` with a plain-English message when the code is still referenced.

- [ ] **Step 1: Write the failing tests**

Add to `tests/core/reference.test.ts`. Import `deleteHsn` on the existing import line from `../../src/main/core/reference`.

```ts
describe('deleteHsn', () => {
  it('removes an unused product', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    deleteHsn(db, '3902')
    expect(listHsn(db)).toEqual([])
  })

  it('refuses to delete a product a purchase still uses', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    db.prepare(`INSERT INTO purchases (our_code, invoice_date, hsn_code, qty_kg, qty_remaining_kg, fy_label, code_seq)
      VALUES ('0001/2425', '2024-05-01', '3902', 100, 100, '2024-25', 1)`).run()
    expect(() => deleteHsn(db, '3902')).toThrow(/1 purchase/)
    expect(listHsn(db)).toHaveLength(1)
  })

  it('refuses to delete a product an invoice still uses', () => {
    upsertHsn(db, { hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 })
    db.prepare(`INSERT INTO sales (invoice_number, seq, fy_label) VALUES ('RP/001/2024-25', 1, '2024-25')`).run()
    db.prepare(`INSERT INTO sale_allocations (sale_id, purchase_id, hsn_code, gst_rate, qty_drawn_kg, rate_per_kg, line_amount)
      VALUES (1, 1, '3902', 5, 10, 100, 1000)`).run()
    expect(() => deleteHsn(db, '3902')).toThrow(/1 invoice/)
    expect(listHsn(db)).toHaveLength(1)
  })

  it('deleting a code that does not exist is a no-op', () => {
    expect(() => deleteHsn(db, '9999')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/core/reference.test.ts`
Expected: FAIL — `deleteHsn is not a function` / no export named `deleteHsn`.

- [ ] **Step 3: Write the implementation**

Append to `src/main/core/reference.ts`:

```ts
// An HSN code is referenced by name (not by foreign key) from purchases and from the
// gst_rate snapshot on sale_allocations. Deleting one that is still in use would leave
// old invoices printing a blank description, so refuse and say who is using it.
export function deleteHsn(db: Database.Database, code: string): void {
  const purchases = (db.prepare('SELECT COUNT(*) AS n FROM purchases WHERE hsn_code = ?').get(code) as { n: number }).n
  const invoices = (db.prepare('SELECT COUNT(DISTINCT sale_id) AS n FROM sale_allocations WHERE hsn_code = ?').get(code) as { n: number }).n
  if (purchases > 0 || invoices > 0) {
    const used = [
      purchases > 0 ? `${purchases} purchase${purchases === 1 ? '' : 's'}` : null,
      invoices > 0 ? `${invoices} invoice${invoices === 1 ? '' : 's'}` : null
    ].filter(Boolean).join(' and ')
    throw new Error(`Product ${code} is used by ${used}, so it can't be deleted. You can still change its description or GST %.`)
  }
  db.prepare('DELETE FROM hsn_products WHERE hsn_code = ?').run(code)
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/core/reference.test.ts`
Expected: PASS (6 tests in the file).

- [ ] **Step 5: Commit**

```bash
git add src/main/core/reference.ts tests/core/reference.test.ts
git commit -m "feat(hsn): deleteHsn with a purchase/invoice reference guard"
```

---

### Task 2: Expose `deleteHsn` over IPC

**Files:**
- Modify: `src/shared/api.ts` (the `Api` interface near line 43, and the `CHANNELS` array)
- Modify: `src/main/ipc.ts:11` (import) and `:82` (handler)
- Test: `tests/core/api-shape.test.ts:9`

**Interfaces:**
- Consumes: `deleteHsn(db, code)` from Task 1.
- Produces: `window.api.deleteHsn(code: string): Promise<void>` for the renderer.

- [ ] **Step 1: Write the failing test**

In `tests/core/api-shape.test.ts`, add `'deleteHsn'` to `API_METHODS` — change the line listing the HSN methods so it reads:

```ts
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listSuppliers','createSupplier','updateSupplier','deleteSupplier','listHsn','upsertHsn','deleteHsn','listFinancialYears','exportCsv'
```

- [ ] **Step 2: Run the test and verify it fails**

Run: `npx vitest run tests/core/api-shape.test.ts`
Expected: FAIL — expected `CHANNELS` to contain `"deleteHsn"`.

- [ ] **Step 3: Wire the channel through**

In `src/shared/api.ts`, add to the `Api` interface under the `// hsn` comment:

```ts
  deleteHsn(code: string): Promise<void>
```

and add `'deleteHsn'` to `CHANNELS`, immediately after `'upsertHsn'`:

```ts
  'listCustomers','createCustomer','updateCustomer','deleteCustomer','listSuppliers','createSupplier','updateSupplier','deleteSupplier','listHsn','upsertHsn','deleteHsn','listFinancialYears'
```

In `src/main/ipc.ts`, change the import on line 11 to:

```ts
import { listHsn, upsertHsn, deleteHsn } from './core/reference'
```

and add a handler after `h('upsertHsn', ...)`:

```ts
  h('deleteHsn', (code) => deleteHsn(db(), code))
```

- [ ] **Step 4: Run the tests and typecheck**

Run: `npx vitest run tests/core/api-shape.test.ts && npm run typecheck`
Expected: PASS, and typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/api.ts src/main/ipc.ts tests/core/api-shape.test.ts
git commit -m "feat(hsn): expose deleteHsn over IPC"
```

---

### Task 3: `HsnEditor` component with per-row Edit and Delete

**Files:**
- Create: `src/renderer/components/HsnEditor.tsx`
- Modify: `src/renderer/screens/Settings.tsx` (remove the Products Paper at lines 138-158, the `hsn`/`newHsn` state at lines 32-33, the `addHsn` function at lines 62-73, and the `setHsn(await window.api.listHsn())` call in `reload`; render `<HsnEditor />` in place of the removed Paper)
- Test: `tests/renderer/hsn-editor.test.tsx`

**Interfaces:**
- Consumes: `window.api.listHsn()`, `window.api.upsertHsn(h)`, `window.api.deleteHsn(code)`; `ListTable` from `../components/ListTable`; `MoneyInput` from `../components/MoneyInput`; `renderWithMantine` from `./mantine` in tests.
- Produces: default-exported `HsnEditor` React component taking no props. Self-contained: loads its own list and refreshes it after every write.

The component is self-contained (no props) so it can be mounted in a test without the Settings business form and its `getSettings` round-trip.

- [ ] **Step 1: Write the failing tests**

Create `tests/renderer/hsn-editor.test.tsx`:

Uses `fireEvent` (not `user-event`), matching every other renderer test in this repo — `@testing-library/user-event` is not a dependency and adding one is not warranted here.

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import HsnEditor from '../../src/renderer/components/HsnEditor'

const listHsn = vi.fn()
const upsertHsn = vi.fn()
const deleteHsn = vi.fn()

const codeInput = () => screen.getByLabelText(/HSN code/i) as HTMLInputElement
const descInput = () => screen.getByLabelText(/Description/i) as HTMLInputElement
const btn = (name: RegExp) => screen.getByRole('button', { name })

beforeEach(() => {
  vi.clearAllMocks()
  listHsn.mockResolvedValue([{ hsn_code: '3902', description: 'Polypropylene', gst_rate: 5 }])
  upsertHsn.mockResolvedValue(undefined)
  deleteHsn.mockResolvedValue(undefined)
  ;(window as unknown as { api: unknown }).api = { listHsn, upsertHsn, deleteHsn }
})

describe('HsnEditor', () => {
  it('lists existing products', async () => {
    renderWithMantine(<HsnEditor />)
    expect(await screen.findByText('Polypropylene')).toBeTruthy()
  })

  it('Edit prefills the form and locks the HSN code', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))

    expect(codeInput().value).toBe('3902')
    expect(codeInput().disabled).toBe(true)
    expect(descInput().value).toBe('Polypropylene')
    expect(btn(/save changes/i)).toBeTruthy()
  })

  it('saves an edited description against the original code', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))
    fireEvent.change(descInput(), { target: { value: 'PP Granules' } })
    fireEvent.click(btn(/save changes/i))

    await waitFor(() => expect(upsertHsn).toHaveBeenCalledWith(
      { hsn_code: '3902', description: 'PP Granules', gst_rate: 5 }
    ))
  })

  it('Cancel returns the form to add mode', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /edit/i }))
    fireEvent.click(btn(/cancel/i))

    expect(codeInput().value).toBe('')
    expect(codeInput().disabled).toBe(false)
    expect(btn(/^add$/i)).toBeTruthy()
  })

  it('adds a new product and clears the form', async () => {
    renderWithMantine(<HsnEditor />)
    await screen.findByText('Polypropylene')
    fireEvent.change(codeInput(), { target: { value: '3901' } })
    fireEvent.change(descInput(), { target: { value: 'LLDPE' } })
    fireEvent.click(btn(/^add$/i))

    await waitFor(() => expect(upsertHsn).toHaveBeenCalledWith(
      { hsn_code: '3901', description: 'LLDPE', gst_rate: 18 }
    ))
    await waitFor(() => expect(codeInput().value).toBe(''))
  })

  it('deletes after confirmation and refreshes the list', async () => {
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /delete/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^delete product$/i }))

    await waitFor(() => expect(deleteHsn).toHaveBeenCalledWith('3902'))
    await waitFor(() => expect(listHsn).toHaveBeenCalledTimes(2))   // initial load + refresh after delete
  })

  it('shows the guard message when a delete is refused', async () => {
    deleteHsn.mockRejectedValue(new Error("Product 3902 is used by 1 purchase, so it can't be deleted."))
    renderWithMantine(<HsnEditor />)
    fireEvent.click(await screen.findByRole('button', { name: /delete/i }))
    fireEvent.click(await screen.findByRole('button', { name: /^delete product$/i }))

    expect(await screen.findByText(/used by 1 purchase/i)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npx vitest run tests/renderer/hsn-editor.test.tsx`
Expected: FAIL — cannot resolve `../../src/renderer/components/HsnEditor`.

- [ ] **Step 3: Write the component**

Create `src/renderer/components/HsnEditor.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { Paper, Title, TextInput, Button, Group, Input, Table, Text, Modal } from '@mantine/core'
import type { HsnProduct } from '@shared/types'
import ListTable from './ListTable'
import MoneyInput from './MoneyInput'

const BLANK: HsnProduct = { hsn_code: '', description: '', gst_rate: 18 }

export default function HsnEditor() {
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [draft, setDraft] = useState<HsnProduct>(BLANK)
  const [editing, setEditing] = useState<string | null>(null)   // the HSN code being edited, or null in add mode
  const [confirming, setConfirming] = useState<HsnProduct | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Refresh only this section's list. Calling Settings' reload() here would reset the
  // business form above and silently discard the user's unsaved edits.
  async function refresh() { setHsn(await window.api.listHsn()) }
  useEffect(() => { refresh() }, [])

  function startEdit(h: HsnProduct) { setEditing(h.hsn_code); setDraft({ ...h }); setError(null) }
  function cancel() { setEditing(null); setDraft(BLANK); setError(null) }

  async function save() {
    const code = draft.hsn_code.trim()
    if (!code) { setError('Enter an HSN code.'); return }
    try {
      await window.api.upsertHsn({ ...draft, hsn_code: code, description: draft.description.trim() })
      cancel()
      await refresh()
    } catch (e) {
      setError(`Couldn't save this product: ${(e as Error).message}`)
    }
  }

  async function confirmDelete() {
    const target = confirming
    if (!target) return
    setConfirming(null)
    try {
      await window.api.deleteHsn(target.hsn_code)
      if (editing === target.hsn_code) cancel()
      await refresh()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Paper withBorder p="lg" radius="md" mb="md">
      <Title order={2} mb="sm">Products (HSN)</Title>

      <ListTable head={<><Table.Th>HSN</Table.Th><Table.Th>Description</Table.Th><Table.Th>GST %</Table.Th><Table.Th /></>}>
        {hsn.map(h => (
          <Table.Tr key={h.hsn_code}>
            <Table.Td>{h.hsn_code}</Table.Td>
            <Table.Td>{h.description}</Table.Td>
            <Table.Td>{h.gst_rate}</Table.Td>
            <Table.Td>
              <Group gap="xs" justify="flex-end" wrap="nowrap">
                <Button size="xs" variant="default" onClick={() => startEdit(h)}>Edit</Button>
                <Button size="xs" variant="subtle" color="red" onClick={() => { setError(null); setConfirming(h) }}>Delete</Button>
              </Group>
            </Table.Td>
          </Table.Tr>
        ))}
        {hsn.length === 0 && <Table.Tr><Table.Td colSpan={4} c="dimmed">No products yet.</Table.Td></Table.Tr>}
      </ListTable>

      <Group mt="md" align="flex-end">
        <TextInput label="HSN code" disabled={editing !== null} value={draft.hsn_code}
          onChange={e => setDraft({ ...draft, hsn_code: e.currentTarget.value })} />
        <TextInput label="Description" style={{ flex: 1 }} value={draft.description}
          onChange={e => setDraft({ ...draft, description: e.currentTarget.value })} />
        <Input.Wrapper label="GST %">
          <MoneyInput value={draft.gst_rate} onChange={n => setDraft({ ...draft, gst_rate: n })} />
        </Input.Wrapper>
        <Button onClick={save}>{editing ? 'Save changes' : 'Add'}</Button>
        {editing && <Button variant="default" onClick={cancel}>Cancel</Button>}
      </Group>

      {error && <Text c="red" size="sm" mt="sm">{error}</Text>}
      <Text c="dimmed" size="sm" mt="sm">
        Changing a GST % applies to new sales only — invoices already made keep the rate they were issued with.
      </Text>

      <Modal opened={confirming !== null} onClose={() => setConfirming(null)} title="Delete this product?" centered>
        <Text mb="lg">
          {confirming ? `${confirming.hsn_code}${confirming.description ? ` — ${confirming.description}` : ''} will be removed from the product list.` : ''}
        </Text>
        <Group justify="flex-end">
          <Button variant="default" onClick={() => setConfirming(null)}>Keep it</Button>
          <Button color="red" onClick={confirmDelete}>Delete product</Button>
        </Group>
      </Modal>
    </Paper>
  )
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run: `npx vitest run tests/renderer/hsn-editor.test.tsx`
Expected: PASS (7 tests).

- [ ] **Step 5: Wire it into Settings**

In `src/renderer/screens/Settings.tsx`:
- Add `import HsnEditor from '../components/HsnEditor'`.
- Delete the `hsn` and `newHsn` `useState` lines (32-33) and the whole `addHsn` function (62-73).
- Delete the `setHsn(await window.api.listHsn())` line from `reload()`.
- Replace the entire Products `<Paper>` block (138-158) with `<HsnEditor />`.
- Drop now-unused imports (`Table`, `ListTable`, and `HsnProduct` from the type import) — leave `MoneyInput`, `Input`, `TextInput`, `Group`, `Button` etc., which the business form still uses.

- [ ] **Step 6: Run the full suite and typecheck**

Run: `npm test && npm run typecheck`
Expected: all tests pass, typecheck exits 0. `npm run typecheck` catches any import left dangling in Settings.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/HsnEditor.tsx src/renderer/screens/Settings.tsx tests/renderer/hsn-editor.test.tsx
git commit -m "feat(hsn): edit and delete products from Settings"
```
