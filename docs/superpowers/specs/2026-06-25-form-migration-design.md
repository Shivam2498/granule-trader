# Migrate Forms to @mantine/form — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review
**Sub-project:** E of the refinement batch (A Suppliers, B sale fixes, C plain-English errors, D FY ledger all merged).

## 1. Purpose

The Suppliers form was built on `@mantine/form` (`useForm`); the older forms
(CustomerForm, PurchaseForm, FirstRun, Settings) still use a hand-rolled
`errs`/`valid` or bespoke `attempted` pattern. Migrate them all to `@mantine/form`
for one consistent form architecture, unify the Save UX, and de-duplicate the repeated
validators. Behaviour-preserving, except two deliberate, approved changes (below).

## 2. Decisions (locked)

- **All forms use `@mantine/form`**: `useForm({ mode: 'controlled' })` + `getInputProps`
  + a `validate` object. Custom components (`PincodeField`, `StateSelect`, `MoneyInput`,
  `SignedMoneyInput`, `DateField`, `Select`) are wired via `form.values.*` +
  `form.setFieldValue(...)` + `form.errors.*` (they cannot take `getInputProps`).
- **Unified Save UX — click-to-reveal:** every form's Save/primary button is
  **always clickable** and calls `form.onSubmit(handleSave)`; submitting an invalid form
  reveals the field errors and does not persist. The current disabled-until-valid Save on
  CustomerForm/PurchaseForm is replaced by this (matches onboarding + SupplierForm).
- **Same rules + same save payloads** as today (see §5 per-form), with two approved
  exceptions: (a) **Settings gains seller validation** matching onboarding; (b) error
  **timing** follows the `@mantine/form` idiom (reveal on submit, then live) rather than
  each form's prior bespoke timing — the rule set and gating are unchanged.
- **Shared validators** (`src/renderer/lib/formValidators.ts`): `vGstin`, `vPhone`,
  `vPincode` reused by all five forms (incl. refactoring SupplierForm to them). Required
  fields use `@mantine/form`'s built-in `isNotEmpty(msg)`.
- No change to data writes, IPC, tax, numbering, draw-down, or schema. Renderer-only.

## 3. Shared validators

`src/renderer/lib/formValidators.ts`:

```ts
import { isGstin, isMobile, isPincode, VMSG } from '@shared/validation'

export const vGstin = (v: string): string | null => (isGstin(v) ? null : VMSG.gstin)
export const vPhone = (v: string): string | null => (isMobile(v) ? null : VMSG.phone)
export const vPincode = (v: string): string | null => (isPincode(v) ? null : VMSG.pincode)
```

(`VMSG` was added in sub-project C.) `SupplierForm.tsx` is refactored to import these in
place of its inline `(v) => isGstin(v) ? null : VMSG.gstin` rules.

## 4. Common wiring patterns (apply in every form)

- **GSTIN → PAN derive:** the GSTIN field spreads `getInputProps('gstin')` then overrides
  `onChange` to set both: `form.setFieldValue('gstin', v.toUpperCase())` and
  `form.setFieldValue('pan', panFromGstin(v))`. PAN field is `disabled value={form.values.pan}`.
- **Phone digits-only:** override `onChange` to
  `form.setFieldValue('phone', e.currentTarget.value.replace(/\D/g,'').slice(0,10))`.
- **PincodeField:** `value={form.values.pincode}`, `onChange={v => form.setFieldValue('pincode', v)}`,
  `onResolved={r => { form.setFieldValue('city', r.city); form.setFieldValue('state', r.state) }}`,
  wrapped in `Input.Wrapper` with `error={form.errors.pincode}`.
- **StateSelect:** `value={form.values.state}`, `onChange={v => form.setFieldValue('state', v)}`,
  in an `Input.Wrapper` with `error={form.errors.state}`.
- **Save:** `<Button onClick={() => form.onSubmit(handleSave)()}>` (the no-arg call form
  is needed so the Mantine `FormEventHandler` satisfies the Button `onClick` type — this is
  exactly what SupplierForm does).
- **Edit-load:** fetch the record, then `form.setValues(rest)` (replacing the old
  `setForm(rest)`).

## 5. Per-form migration (payloads preserved)

### 5.1 CustomerForm
- Fields: name\*, gstin\* (→ pan read-only), phone\*, billing_{city\*,state\*,pincode,address\*},
  shipping_same, shipping_{address,city,state,pincode}.
- `validate`: `name: isNotEmpty('Enter the name.')`, `gstin: vGstin`, `phone: vPhone`,
  `billing_city: isNotEmpty('Enter the city.')`, `billing_state: isNotEmpty('Choose the state.')`,
  `billing_pincode: vPincode`, `billing_address: isNotEmpty('Enter the address.')`, and the
  **shipping** fields validated only when not same:
  `shipping_city: (v, values) => values.shipping_same ? null : (v.trim() ? null : 'Enter the shipping city.')`
  (same shape for shipping_address/shipping_state, and `shipping_pincode: (v, values) => values.shipping_same ? null : vPincode(v)`).
- Save payload unchanged: `{ ...form.values, gstin: …toUpperCase(), pan: …toUpperCase() }` →
  `createCustomer`/`updateCustomer`; success toast; nav to `/customers`.

### 5.2 PurchaseForm
- Fields in the form: our_code\*, supplier_invoice_number, invoice_date\*, hsn_code\*,
  supplier_id\*, qty_kg, rate_per_kg, roundoff, tcs, payment_status, payment_date.
- `validate`: `our_code: isNotEmpty('Enter the code.')`,
  `invoice_date: isNotEmpty('Pick the invoice date.')`, `hsn_code: isNotEmpty('Choose the HSN.')`,
  `supplier_id: (v) => v ? null : 'Choose a supplier.'`,
  `qty_kg: (v) => v > 0 ? null : 'Enter a quantity.'`,
  `rate_per_kg: (v) => v > 0 ? null : 'Enter a rate per kg.'`.
- Derived values (amount, gstRate, `supplier`, tax preview) now read `form.values.*`. The
  auto-suggested `our_code` effect and edit-load use `form.setFieldValue`/`form.setValues`.
- Save payload unchanged (supplier snapshot into `party*`, `supplier_id`, gst_rate, etc.) →
  `createPurchase`/`updatePurchase`; nav to `/purchases`.

### 5.3 FirstRun (onboarding)
- The bespoke `attempted`/`reqErr` state is removed; `useForm` holds all fields, including
  `folder` (the data-folder path; `''` = none). The folder **picker** writes via
  `form.setFieldValue('folder', f)`; the folder input stays `disabled` showing `form.values.folder`.
- `validate`: `folder: (v) => v ? null : 'Choose a data folder.'`,
  `name: isNotEmpty('Enter the business name.')`, `prefix: isNotEmpty('Enter the invoice prefix.')`,
  `mobile: vPhone`, `gstin: vGstin`, `homeState: isNotEmpty('Choose the home state.')`,
  `pincode: (v) => !v ? null : vPincode(v)` (pincode optional — matches today).
- **Prefix-from-name** preserved: name `onChange` sets `name` and, unless the prefix was
  hand-edited (`prefixEdited` kept as a `useState`), `form.setFieldValue('prefix', deriveInvoicePrefix(v))`.
- Start button → `form.onSubmit(start)`; `start` saves via `saveSettings(...)` exactly as
  today (trimmed/uppercased fields) then `onDone()`.

### 5.4 Settings — gains seller validation
- The seller/config block becomes a `useForm` over the `Settings` object (all fields it
  currently edits: seller_*, home_state, invoice_prefix, default_gst_rate,
  low_stock_threshold, backups_to_keep, data_folder).
- `validate` (seller fields, matching onboarding): `seller_name: isNotEmpty('Enter the business name.')`,
  `seller_gstin: vGstin`, `seller_phone: vPhone`, `home_state: isNotEmpty('Choose the home state.')`,
  `seller_pincode: (v) => !v ? null : vPincode(v)`. The numeric/config fields and the disabled
  `data_folder` get no rules.
- "Save settings" → `form.onSubmit(save)`; `save` calls `saveSettings(form.getValues())` + toast.
- **Unchanged:** the HSN products table + add-widget (`newHsn` stays plain `useState` +
  `upsertHsn`/`listHsn`), the "Backup now" button. These are not part of the seller form.

## 6. Testing

- **Unit:** `tests/renderer/form-validators.test.ts` for `vGstin`/`vPhone`/`vPincode`
  (valid → `null`; invalid → the exact `VMSG.*` string).
- **Per-form:** verified by `npm run typecheck` + the full suite staying green +
  `npm run build`, and a review that diffs each form's **save payload and validate rules**
  against the pre-migration version (must be identical, except Settings gains the rules in
  §5.4 and every Save becomes click-to-reveal). The existing renderer tests
  (`sidebar`, `state-select`, `money-input`, etc.) must stay green.
- Operator manual pass per form: empty Save reveals inline errors; a valid Save persists
  the same data as before; GSTIN fills the greyed PAN; pincode auto-fills city/state.

## 7. Out of scope

- The Settings HSN add-widget (stays plain state).
- Any layout/visual redesign, or validation-rule changes beyond Settings adopting the
  onboarding rules.
- `@mantine/form` advanced features (uncontrolled mode, form context, schema resolvers).
- Any change to data writes, IPC, tax, numbering, draw-down, or schema.

## 8. Open items

None.
