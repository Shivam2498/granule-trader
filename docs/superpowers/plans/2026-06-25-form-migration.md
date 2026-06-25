# Migrate Forms to @mantine/form Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate CustomerForm, PurchaseForm, FirstRun, and Settings to `@mantine/form` with a unified always-clickable click-to-reveal Save, shared validators, and identical save payloads (Settings additionally gains onboarding seller validation).

**Architecture:** A shared `formValidators.ts` (`vGstin/vPhone/vPincode`) is added and SupplierForm refactored onto it (establishing the template). Each remaining form is converted to `useForm({ mode: 'controlled' })` + `getInputProps` + a `validate` object; custom components (PincodeField/StateSelect/MoneyInput/DateField/Select) are wired via `form.values`/`form.setFieldValue`/`form.errors`; Save is `onClick={() => form.onSubmit(handleSave)()}`. Behaviour-preserving except the unified Save UX and Settings' new rules.

**Tech Stack:** React 18, TypeScript, Mantine v7, @mantine/form (already installed at 7.17.8), Vitest.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-form-migration-design.md` is authoritative; §5 pins each form's preserved payload + rules.
- **`@mantine/form` everywhere:** `useForm({ mode: 'controlled' })` + `getInputProps` + `validate`. Custom components use `form.values.X` + `form.setFieldValue('X', …)` + `form.errors.X` (they can't take `getInputProps`).
- **Unified Save = click-to-reveal:** Save is always clickable, `onClick={() => form.onSubmit(handleSave)()}`; an invalid submit reveals errors and does not persist. No `disabled={!valid}`.
- **Same save payloads** as today (GSTIN/PAN uppercased on save, phone digits-only, PAN derived from GSTIN, pincode auto-fills city/state, FirstRun prefix-from-name). **Only** Settings gains rules (§5.4 of the spec).
- **Shared validators** in `src/renderer/lib/formValidators.ts`; required fields use `isNotEmpty(msg)` from `@mantine/form`.
- `SupplierForm.tsx` is the working reference for every pattern (it already uses `useForm`).
- No change to data writes, IPC, tax, numbering, draw-down, or schema. Renderer-only. Build stays green each task (`npm test` + `npm run typecheck` + `npm run build`). Do NOT run `npm run dev`.

---

## File Structure

- `src/renderer/lib/formValidators.ts` *(new)* — `vGstin/vPhone/vPincode`.
- `tests/renderer/form-validators.test.ts` *(new)* — their tests.
- `src/renderer/screens/SupplierForm.tsx` — refactor to use the shared validators.
- `src/renderer/screens/CustomerForm.tsx`, `PurchaseForm.tsx`, `FirstRun.tsx`, `Settings.tsx` — convert to `useForm`.

---

## Task 1: Shared validators + refactor SupplierForm

**Files:**
- Create: `src/renderer/lib/formValidators.ts`, `tests/renderer/form-validators.test.ts`
- Modify: `src/renderer/screens/SupplierForm.tsx`

**Interfaces:**
- Produces (consumed by Tasks 2-5): `vGstin(v: string): string | null`, `vPhone(v: string): string | null`, `vPincode(v: string): string | null` from `../lib/formValidators`.

- [ ] **Step 1: Write the failing test** (`tests/renderer/form-validators.test.ts`)

```ts
import { describe, it, expect } from 'vitest'
import { vGstin, vPhone, vPincode } from '../../src/renderer/lib/formValidators'
import { VMSG } from '../../src/shared/validation'

describe('form validators', () => {
  it('vGstin: null when valid, VMSG.gstin when not', () => {
    expect(vGstin('24CCGPC8555A1Z5')).toBeNull()
    expect(vGstin('nope')).toBe(VMSG.gstin)
  })
  it('vPhone: null when 10 digits, VMSG.phone when not', () => {
    expect(vPhone('9876543210')).toBeNull()
    expect(vPhone('123')).toBe(VMSG.phone)
  })
  it('vPincode: null when 6 digits, VMSG.pincode when not', () => {
    expect(vPincode('395003')).toBeNull()
    expect(vPincode('99')).toBe(VMSG.pincode)
  })
})
```

- [ ] **Step 2: Run it, verify it fails**

Run: `npx vitest run tests/renderer/form-validators.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement** (`src/renderer/lib/formValidators.ts`)

```ts
import { isGstin, isMobile, isPincode, VMSG } from '@shared/validation'

export const vGstin = (v: string): string | null => (isGstin(v) ? null : VMSG.gstin)
export const vPhone = (v: string): string | null => (isMobile(v) ? null : VMSG.phone)
export const vPincode = (v: string): string | null => (isPincode(v) ? null : VMSG.pincode)
```

- [ ] **Step 4: Run it, verify it passes**

Run: `npx vitest run tests/renderer/form-validators.test.ts`
Expected: PASS.

- [ ] **Step 5: Refactor SupplierForm to use them** (`src/renderer/screens/SupplierForm.tsx`)

In the `validate` object, replace the inline gstin/phone/pincode rules with the shared ones, and add the import:

```ts
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
```

```tsx
    validate: {
      name: isNotEmpty('Enter the name.'),
      gstin: vGstin,
      phone: vPhone,
      city: isNotEmpty('Enter the city.'),
      state: isNotEmpty('Choose the state.'),
      address: isNotEmpty('Enter the address.'),
      pincode: vPincode
    }
```

Remove `isGstin`, `isMobile`, `isPincode` from the `@shared/validation` import **if** they
are now unused there (keep `panFromGstin`). Keep everything else in SupplierForm unchanged.

- [ ] **Step 6: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: green (SupplierForm behaves identically; same messages via VMSG).

- [ ] **Step 7: Commit**

```bash
git add src/renderer/lib/formValidators.ts tests/renderer/form-validators.test.ts src/renderer/screens/SupplierForm.tsx
git commit -m "feat: shared form validators (vGstin/vPhone/vPincode); SupplierForm uses them"
```

---

## Task 2: CustomerForm → useForm

**Files:**
- Modify: `src/renderer/screens/CustomerForm.tsx`
- Test: none (typecheck + suite + build; payload must match spec §5.1)

**Interfaces:** Consumes `vGstin/vPhone/vPincode`, `isNotEmpty` from `@mantine/form`, `panFromGstin`.

Reference: `SupplierForm.tsx` is the same shape minus the shipping block. Preserve the
existing `FormPage`/`FormSection` layout, the shipping `Checkbox`, and the shipping section.

- [ ] **Step 1: Convert state to `useForm`**

Replace `const [form, setForm] = useState(EMPTY)` + `set` with:

```tsx
import { useForm, isNotEmpty } from '@mantine/form'
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
```

```tsx
  const form = useForm<Omit<Customer, 'id'>>({
    mode: 'controlled',
    initialValues: EMPTY,
    validate: {
      name: isNotEmpty('Enter the name.'),
      gstin: vGstin,
      phone: vPhone,
      billing_city: isNotEmpty('Enter the city.'),
      billing_state: isNotEmpty('Choose the state.'),
      billing_pincode: vPincode,
      billing_address: isNotEmpty('Enter the address.'),
      shipping_address: (v, values) => values.shipping_same ? null : (v.trim() ? null : 'Enter the shipping address.'),
      shipping_city: (v, values) => values.shipping_same ? null : (v.trim() ? null : 'Enter the shipping city.'),
      shipping_state: (v, values) => values.shipping_same ? null : (v.trim() ? null : 'Choose the shipping state.'),
      shipping_pincode: (v, values) => values.shipping_same ? null : vPincode(v)
    }
  })
```

- [ ] **Step 2: Edit-load via `form.setValues`**

In the `useEffect` that loads the customer, replace `setForm(rest)` with `form.setValues(rest)`.

- [ ] **Step 3: Convert the fields**

- Name: `<TextInput label="Name" withAsterisk {...form.getInputProps('name')} />`
- GSTIN (override onChange to derive PAN):
  ```tsx
        <TextInput label="GSTIN" withAsterisk {...form.getInputProps('gstin')}
          onChange={e => { const v = e.currentTarget.value.toUpperCase(); form.setFieldValue('gstin', v); form.setFieldValue('pan', panFromGstin(v)) }} />
  ```
- PAN: `<TextInput label="PAN (from GSTIN)" disabled value={form.values.pan} />`
- Phone: `<TextInput label="Phone" withAsterisk {...form.getInputProps('phone')} onChange={e => form.setFieldValue('phone', e.currentTarget.value.replace(/\D/g,'').slice(0,10))} />`
- Billing Pincode (`Input.Wrapper` + PincodeField): `value={form.values.billing_pincode}`,
  `onChange={v => form.setFieldValue('billing_pincode', v)}`,
  `onResolved={r => { form.setFieldValue('billing_city', r.city); form.setFieldValue('billing_state', r.state) }}`,
  wrapper `error={form.errors.billing_pincode}`.
- Billing City: `<TextInput label="City" {...form.getInputProps('billing_city')} />`
- Billing State (`Input.Wrapper` + StateSelect): `value={form.values.billing_state}`,
  `onChange={v => form.setFieldValue('billing_state', v)}`, wrapper `error={form.errors.billing_state}`.
- Billing Address: `<Textarea label="Address" autosize minRows={2} {...form.getInputProps('billing_address')} />`
- Shipping checkbox: `<Checkbox label="Shipping address is the same as billing" {...form.getInputProps('shipping_same', { type: 'checkbox' })} />`
- Shipping section (when `!form.values.shipping_same`): same wiring as billing but on the `shipping_*` keys.

- [ ] **Step 4: Save handler + button**

```tsx
  async function handleSave(values: Omit<Customer, 'id'>) {
    setError('')
    try {
      const payload = { ...values, gstin: values.gstin.toUpperCase(), pan: values.pan.toUpperCase() }
      if (editId) await window.api.updateCustomer(editId, payload); else await window.api.createCustomer(payload)
      notifications.show({ message: 'Customer saved', color: 'green' })
      nav('/customers')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }
```

Footer Save: `<Button onClick={() => form.onSubmit(handleSave)()}>Save customer</Button>` (remove `disabled={!valid}`). Keep the Cancel button. Remove the old `errs`/`valid`/`save`/`set` code.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: green, no unused imports (`isGstin/isMobile/isPincode` likely now unused — drop them, keep `panFromGstin`). Manual: empty Save reveals errors; shipping errors only when "same" is unchecked; save writes the same payload.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/CustomerForm.tsx
git commit -m "refactor: CustomerForm on @mantine/form (click-to-reveal Save)"
```

---

## Task 3: PurchaseForm → useForm

**Files:**
- Modify: `src/renderer/screens/PurchaseForm.tsx`
- Test: none (typecheck + suite + build; payload must match spec §5.2)

**Interfaces:** Consumes `isNotEmpty` from `@mantine/form`; the form already has no GSTIN.

Reference: keep all derived logic (amount, gstRate, `supplier`, tax preview, `our_code`
auto-suggest, edit-load) — just source it from `form.values` and write via `form.setFieldValue`.

- [ ] **Step 1: Convert state to `useForm`**

```tsx
import { useForm, isNotEmpty } from '@mantine/form'
```

```tsx
  const form = useForm({
    mode: 'controlled',
    initialValues: {
      our_code: '', supplier_invoice_number: '', invoice_date: today(),
      supplier_id: null as number | null,
      hsn_code: '', qty_kg: 0, rate_per_kg: 0, roundoff: 0, tcs: 0,
      payment_status: 'pending' as 'pending' | 'done', payment_date: '' as string
    },
    validate: {
      our_code: isNotEmpty('Enter the code.'),
      invoice_date: isNotEmpty('Pick the invoice date.'),
      hsn_code: isNotEmpty('Choose the HSN.'),
      supplier_id: (v) => v ? null : 'Choose a supplier.',
      qty_kg: (v) => v > 0 ? null : 'Enter a quantity.',
      rate_per_kg: (v) => v > 0 ? null : 'Enter a rate per kg.'
    }
  })
```

- [ ] **Step 2: Re-source derived values from `form.values`**

```tsx
  const supplier = suppliers.find(s => s.id === form.values.supplier_id) ?? null
  const amount = round2(form.values.qty_kg * form.values.rate_per_kg)
  const gstRate = hsn.find(h => h.hsn_code === form.values.hsn_code)?.gst_rate ?? settings.default_gst_rate
  const tax = computeTax({ amount, gstRate, placeOfSupplyState: supplier?.state ?? '', homeState: settings.home_state, tcs: form.values.tcs, roundoff: form.values.roundoff })
```

The `our_code` auto-suggest effect uses `form.values.invoice_date` and
`form.setFieldValue('our_code', c)`; edit-load uses `form.setValues({...})` including
`supplier_id: p.supplier_id`.

- [ ] **Step 3: Convert the fields**

- Our code: `{...form.getInputProps('our_code')}`
- Supplier invoice no.: `{...form.getInputProps('supplier_invoice_number')}`
- Invoice date (`Input.Wrapper` + DateField): `value={form.values.invoice_date}`,
  `onChange={d => form.setFieldValue('invoice_date', d)}`, wrapper `error={form.errors.invoice_date}`.
- HSN (`Select`): `value={form.values.hsn_code || null}`, `onChange={v => form.setFieldValue('hsn_code', v ?? '')}`, `error={form.errors.hsn_code}`.
- Supplier (`Select`): `value={form.values.supplier_id ? String(form.values.supplier_id) : null}`,
  `onChange={v => form.setFieldValue('supplier_id', v ? Number(v) : null)}`, `error={form.errors.supplier_id}`.
  (Keep the read-only supplier `Paper` block using `formatAddress(supplier)`.)
- Quantity (`Input.Wrapper` + MoneyInput): `value={form.values.qty_kg}`, `onChange={n => form.setFieldValue('qty_kg', n)}`, wrapper `error={form.errors.qty_kg}`.
- Rate per kg (MoneyInput): `value={form.values.rate_per_kg}`, `onChange={n => form.setFieldValue('rate_per_kg', n)}`, wrapper `error={form.errors.rate_per_kg}`.
- Round off (SignedMoneyInput): `value={form.values.roundoff}` → `setFieldValue('roundoff', n)`.
- TCS (MoneyInput): `value={form.values.tcs}` → `setFieldValue('tcs', n)`.
- Payment (`Select`): `value={form.values.payment_status}` → `setFieldValue('payment_status', v as 'pending'|'done')`.
- Payment date (when done): `value={form.values.payment_date || today()}` → `setFieldValue('payment_date', d)`.

- [ ] **Step 4: Save handler + button**

```tsx
  async function handleSave(v: typeof form.values) {
    setError('')
    try {
      const payload = {
        our_code: v.our_code, supplier_invoice_number: v.supplier_invoice_number, invoice_date: v.invoice_date,
        supplier_id: v.supplier_id,
        party: supplier?.name ?? '', party_state: supplier?.state ?? '',
        party_city: supplier?.city ?? '', party_pincode: supplier?.pincode ?? '', party_address: supplier?.address ?? '',
        hsn_code: v.hsn_code, qty_kg: v.qty_kg, rate_per_kg: v.rate_per_kg,
        gst_rate: gstRate, homeState: settings!.home_state, roundoff: v.roundoff, tcs: v.tcs,
        payment_status: v.payment_status, payment_date: v.payment_status === 'done' ? (v.payment_date || today()) : null
      }
      if (editId) await window.api.updatePurchase(editId, payload); else await window.api.createPurchase(payload)
      nav('/purchases')
    } catch (e: any) { setError(e.message ?? String(e)) }
  }
```

Footer Save: `<Button onClick={() => form.onSubmit(handleSave)()}>{editId ? 'Update purchase' : 'Save purchase'}</Button>` (remove `disabled={!valid}`). Remove the old `errs`/`valid`/`save`/`set`.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: green, pristine. Manual: empty Save reveals errors; picking a supplier shows read-only details + drives tax; save writes the same snapshot payload.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/PurchaseForm.tsx
git commit -m "refactor: PurchaseForm on @mantine/form (click-to-reveal Save)"
```

---

## Task 4: FirstRun → useForm

**Files:**
- Modify: `src/renderer/screens/FirstRun.tsx`
- Test: none (typecheck + suite + build; payload must match spec §5.3)

**Interfaces:** Consumes `vGstin/vPhone/vPincode`, `isNotEmpty`, `deriveInvoicePrefix`, `panFromGstin`.

The bespoke `attempted`/`reqErr`/`valid` state is removed; `useForm` holds every field
including `folder`. `prefixEdited` stays a `useState`.

- [ ] **Step 1: Convert to `useForm`**

```tsx
import { useForm, isNotEmpty } from '@mantine/form'
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
```

```tsx
  const [prefixEdited, setPrefixEdited] = useState(false)
  const [error, setError] = useState('')
  const form = useForm({
    mode: 'controlled',
    initialValues: { folder: '', name: '', prefix: '', gstin: '', pan: '', mobile: '', homeState: '', address: '', city: '', pincode: '' },
    validate: {
      folder: (v) => v ? null : 'Choose a data folder.',
      name: isNotEmpty('Enter the business name.'),
      prefix: isNotEmpty('Enter the invoice prefix.'),
      mobile: vPhone,
      gstin: vGstin,
      homeState: isNotEmpty('Choose the home state.'),
      pincode: (v) => !v ? null : vPincode(v)
    }
  })
```

- [ ] **Step 2: Folder picker + name→prefix derive write into the form**

```tsx
  async function pick() { const f = await window.api.chooseDataFolder(); if (f) form.setFieldValue('folder', f) }
  function setBusinessName(v: string) {
    form.setFieldValue('name', v)
    if (!prefixEdited) form.setFieldValue('prefix', deriveInvoicePrefix(v))
  }
```

- [ ] **Step 3: Convert the fields** (preserve the existing layout/copy)

- Data folder input: `disabled value={form.values.folder} ` + `error={form.errors.folder}`; the "Choose…" button calls `pick`.
- Business name: `value={form.values.name}` `onChange={e => setBusinessName(e.currentTarget.value)}` `error={form.errors.name}`.
- Invoice prefix: `value={form.values.prefix}` `onChange={e => { form.setFieldValue('prefix', e.currentTarget.value.toUpperCase()); setPrefixEdited(true) }}` `error={form.errors.prefix}`.
- Mobile: `value={form.values.mobile}` `onChange={e => form.setFieldValue('mobile', e.currentTarget.value.replace(/\D/g,'').slice(0,10))}` `error={form.errors.mobile}`.
- GSTIN: `value={form.values.gstin}` `onChange={e => { const v = e.currentTarget.value.toUpperCase(); form.setFieldValue('gstin', v); form.setFieldValue('pan', panFromGstin(v)) }}` `error={form.errors.gstin}`.
- PAN: `disabled value={form.values.pan}`.
- Pincode (`Input.Wrapper` + PincodeField): `value={form.values.pincode}` → `setFieldValue('pincode', v)`; `onResolved={r => { form.setFieldValue('city', r.city); form.setFieldValue('homeState', r.state) }}`; wrapper `error={form.errors.pincode}`.
- City: `value={form.values.city}` → `setFieldValue('city', …)`.
- Address: `value={form.values.address}` → `setFieldValue('address', …)`.
- Home state (`Input.Wrapper` + StateSelect): `value={form.values.homeState}` → `setFieldValue('homeState', v)`; wrapper `error={form.errors.homeState}`.

- [ ] **Step 4: Start handler + button**

```tsx
  async function start(v: typeof form.values) {
    setError('')
    try {
      await window.api.saveSettings({
        seller_name: v.name.trim(), seller_gstin: v.gstin.trim().toUpperCase(), seller_pan: v.pan.trim().toUpperCase(),
        seller_phone: v.mobile.trim(), seller_address: v.address.trim(),
        seller_city: v.city.trim(), seller_pincode: v.pincode.trim(), home_state: v.homeState,
        invoice_prefix: v.prefix.trim().toUpperCase()
      })
      onDone()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }
```

Start button: `<Button onClick={() => form.onSubmit(start)()}>Start using Granule Trader</Button>`.
Keep the top `Alert` bound to `error`. Remove the `valid`/`attempted`/`reqErr` code.

- [ ] **Step 5: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: green, pristine (drop now-unused imports — `isGstin/isMobile/isPincode` are replaced by the shared validators; keep `deriveInvoicePrefix` and `panFromGstin`). Manual: clicking Start with blanks reveals each field's error incl. the data-folder one; typing a name fills the prefix until you edit it; GSTIN fills PAN; save writes the same settings.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/FirstRun.tsx
git commit -m "refactor: FirstRun on @mantine/form (click-to-reveal Start)"
```

---

## Task 5: Settings → useForm (+ seller validation)

**Files:**
- Modify: `src/renderer/screens/Settings.tsx`
- Test: none (typecheck + suite + build; payload matches today + the new rules in spec §5.4)

**Interfaces:** Consumes `vGstin/vPhone/vPincode`, `isNotEmpty`, `panFromGstin`. The HSN
products table + add-widget (`newHsn`) and "Backup now" stay exactly as they are.

- [ ] **Step 1: Hold the settings object in `useForm`**

The settings load is async, so initialise the form once settings arrive. Keep the
`if (!s) return` guard pattern by gating on a loaded flag; build the form with
`initialValues` from the loaded settings via `form.setValues` in `reload`.

```tsx
import { useForm, isNotEmpty } from '@mantine/form'
import { vGstin, vPhone, vPincode } from '../lib/formValidators'
```

```tsx
  const form = useForm<S>({
    mode: 'controlled',
    initialValues: {} as S,
    validate: {
      seller_name: isNotEmpty('Enter the business name.'),
      seller_gstin: vGstin,
      seller_phone: vPhone,
      home_state: isNotEmpty('Choose the home state.'),
      seller_pincode: (v) => !v ? null : vPincode(v)
    }
  })
  const [loaded, setLoaded] = useState(false)
  async function reload() {
    const settings = await window.api.getSettings()
    form.setValues(settings); setLoaded(true)
    setHsn(await window.api.listHsn())
  }
  useEffect(() => { reload() }, [])
  if (!loaded) return <h1>Settings</h1>
```

(Remove the `const [s, setS]` state and the `set` helper; the HSN `newHsn` state stays.)

- [ ] **Step 2: Convert the seller/config fields to `form`**

- Business name: `{...form.getInputProps('seller_name')}`
- GSTIN: `{...form.getInputProps('seller_gstin')}` with onChange override deriving `seller_pan`:
  `onChange={e => { const v = e.currentTarget.value.toUpperCase(); form.setFieldValue('seller_gstin', v); form.setFieldValue('seller_pan', panFromGstin(v)) }}`
- PAN: `disabled value={form.values.seller_pan}`
- Pincode (PincodeField): `value={form.values.seller_pincode}` → `setFieldValue('seller_pincode', v)`;
  `onResolved={r => { form.setFieldValue('seller_city', r.city); form.setFieldValue('home_state', r.state) }}`; wrapper `error={form.errors.seller_pincode}`.
- City: `{...form.getInputProps('seller_city')}`
- Address: `{...form.getInputProps('seller_address')}`
- Mobile: `value={form.values.seller_phone}` `onChange={e => form.setFieldValue('seller_phone', e.currentTarget.value.replace(/\D/g,'').slice(0,10))}` `error={form.errors.seller_phone}`
- Home state (StateSelect): `value={form.values.home_state}` → `setFieldValue('home_state', v)`; wrapper `error={form.errors.home_state}`.
- Invoice prefix: `{...form.getInputProps('invoice_prefix')}`
- Default GST rate / Low-stock threshold / Backups to keep (MoneyInput): `value={form.values.X}` → `setFieldValue('X', n)` (no rules).
- Data folder: `disabled value={form.values.data_folder}`.

- [ ] **Step 3: Save handler + button**

```tsx
  async function save(values: S) { await window.api.saveSettings(values); notifications.show({ message: 'Saved.', color: 'green' }) }
```

"Save settings" button: `<Button onClick={() => form.onSubmit(save)()}>Save settings</Button>`.
Leave "Backup now" (`backup`) and the whole HSN `Paper` (table + `addHsn` add-widget) unchanged.

- [ ] **Step 4: Verify**

Run: `npm run typecheck && npm test && npm run build`
Expected: green, pristine. Manual: editing the seller block and saving with a bad GSTIN/phone/pincode now reveals errors and blocks the save; a valid save persists the same settings object; the HSN add still works; Backup still works.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/screens/Settings.tsx
git commit -m "refactor: Settings seller form on @mantine/form with onboarding validation"
```

---

## Notes for the implementer

- `SupplierForm.tsx` (post-Task-1) is the canonical reference for every wiring pattern.
- The Save/Start/primary button is ALWAYS clickable: `onClick={() => form.onSubmit(handler)()}`.
  Never re-introduce `disabled={!valid}`.
- **Preserve save payloads byte-for-byte** (spec §5): same trims, `.toUpperCase()` on
  GSTIN/PAN, digits-only phone, PAN from GSTIN, FirstRun's prefix-from-name, the purchase
  supplier snapshot. Only Settings gains validation rules — its saved object is unchanged.
- Custom components (`PincodeField`, `StateSelect`, `MoneyInput`, `SignedMoneyInput`,
  `DateField`, `Select`) never take `getInputProps` — bind `form.values.*` / `form.setFieldValue` /
  `form.errors.*` and wrap in `Input.Wrapper` for the error.
- After each conversion, delete the dead `errs`/`valid`/`set`/`setForm` (and `attempted`/`reqErr`
  in FirstRun) and drop now-unused imports so the build stays pristine.
