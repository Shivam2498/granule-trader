# Entry-Form Quality-of-Life Improvements — Design

Three small, independent improvements to the Sale and Purchase entry forms, requested together
because each is a minor UI friction point hit during daily use.

## 1. Auto-rate when amount is entered

**Problem:** In both the Sale "lots" table (New Sale) and the Purchase "items" table
(Add/Edit purchase), the Amount column is `Qty × Rate`, shown read-only. Sometimes the
known number is the total amount on a supplier's bill (or a target sale total), not the
rate — currently that means hand-computing rate = amount / qty on a calculator first.

**Behavior:**
- Amount becomes an editable field alongside Qty and Rate, in both tables.
- Typing Qty or Rate recomputes Amount, exactly as today (unchanged).
- Typing Amount directly recomputes **Rate** as `round(Amount / Qty, 4)` (4 decimal
  places — the existing precision for `rate_per_kg`), leaving Qty untouched.
- If Qty is 0 when Amount is typed, Rate can't be derived (division by zero) — Rate stays
  at its current value (likely 0) until a Qty is entered, at which point normal qty×rate
  behavior resumes.
- The value typed into Amount that can't cleanly reproduce via qty×rate (rounding) is not
  specially preserved — after any Qty/Rate edit, Amount reverts to the qty×rate display.
  Amount is a data-entry shortcut, not a stored field.

**Why no backend change is needed:** Both forms already submit only `qty_kg` and
`rate_per_kg` per line to `createSale`/`updateSale` and `createPurchase`/`updatePurchase` —
neither submits `amount`. The server computes taxable amount from qty × rate itself
(`computeSaleTax` / `computePurchaseTax`). So this is purely local component state in
`NewSale.tsx` and `PurchaseForm.tsx` — no IPC, schema, or type changes.

**Precedent:** `PurchaseForm.tsx`'s edit-load path already does the inverse — legacy
imported purchases that only ever recorded an amount (no rate) backfill
`rate_per_kg = round2(amount / qty_kg)` on load. Same math, now exposed live in the UI.

## 2. Date field with "Today" on the Choose-lots screen

**Problem:** The "Choose stock to sell" screen (`LotSelect.tsx`, reached via "+ Choose
lots" from New Sale) shows available lots "as of" a date, captioned as plain text:
*"available on {date}"*. That date is the sale's own invoice date
(`draft.invoiceDate`, from `SaleDraftContext`, defaulting to today). To view stock as of
a different date, you have to leave this screen, go back to New Sale, change the invoice
date there, then return.

**Behavior:**
- Replace the read-only caption with an editable `DateField` + a "Today" button, placed
  next to the existing Material/Search filters.
- Changing it calls `patch({ invoiceDate: d })` on the shared `SaleDraftContext` — the
  same value New Sale's own date field reads and writes. This is **the same field**, not
  a separate preview date: the list of available lots already refetches whenever
  `draft.invoiceDate` changes (existing `useEffect` dependency), so this just exposes
  that control on the screen where you actually want to change it.
  - Consequence (by design, not a bug to fix): changing the date here also changes the
    invoice date of the sale you're building. This matches the screen's current meaning
    of "available on X" — it was already using this same date, just not letting you edit
    it here.
- "Today" button sets it to `today()` (existing helper from `lib/format`).

## 3. Edit customer/supplier details from the Sale/Purchase form

**Problem:** New Sale shows the selected buyer's GSTIN and address as read-only text,
with the line *"To edit these, open the Customers screen."* Fixing a wrong phone number
or address mid-sale means abandoning the in-progress sale, editing the customer
separately, and finding your way back. Same gap on the Purchase form for suppliers (no
such note there, but the same limitation: `supplier_id` is a plain `Select`, no edit
path).

**Behavior:**
- An **Edit** (pencil icon) button appears next to the buyer's info block in New Sale
  (once a buyer is selected) and next to the supplier `Select` in the Purchase form
  (once a supplier is chosen).
- Clicking it opens a **modal** containing the full Customer or Supplier edit form — the
  same fields as the dedicated Customers/Suppliers screens (name, GSTIN, PAN
  auto-derived, phone, email, billing address, and for customers the
  shipping-same-as-billing toggle + shipping address).
- Save calls the existing `updateCustomer` / `updateSupplier` IPC (unchanged), closes the
  modal, and refreshes the local `customers`/`suppliers` list in the parent screen so the
  buyer/supplier info block reflects the change immediately — the in-progress
  sale/purchase draft is untouched (lots chosen, amounts entered, etc. all survive).
- Cancel discards the edit and closes the modal with no changes.

**Implementation approach — shared field components, not duplicated forms:**
`CustomerForm.tsx` and `SupplierForm.tsx` currently each own their full page (fields +
`FormPage` chrome + save/cancel). To avoid two divergent copies of the same validated
fields:
- Extract the field block (everything currently inside `FormPage`'s children — the
  `FormSection`s of inputs) out of `CustomerForm.tsx` into a new
  `src/renderer/components/CustomerFields.tsx`, taking the same `form` object
  (`UseFormReturnType<Omit<Customer, 'id'>>`) as a prop and rendering the same JSX that's
  there today. Same for `SupplierForm.tsx` → `SupplierFields.tsx`.
- `CustomerForm.tsx`/`SupplierForm.tsx` (the full pages, reached from the
  Customers/Suppliers screens) become thin: they own the `useForm`, the load-for-edit
  effect, and `handleSave`, and render `<FormPage>...<CustomerFields form={form} /></FormPage>`.
  No behavior change on those screens.
- New `src/renderer/components/CustomerEditModal.tsx` (and `SupplierEditModal.tsx`): a
  `Modal` that owns its own `useForm` seeded from the customer/supplier passed in as a
  prop, renders `<CustomerFields form={form} />` inside the modal body, and on save calls
  `updateCustomer`/`updateSupplier` then an `onSaved(updated)` callback so the caller can
  refresh its state — mirroring the validation and save logic already in
  `CustomerForm.tsx`'s `handleSave`, just without the page navigation.
- `NewSale.tsx` and `PurchaseForm.tsx` each hold an `editingParty` boolean, render the
  Edit button conditionally, and the modal conditionally; `onSaved` updates their local
  `customers`/`suppliers` array in place (`setCustomers(cs => cs.map(c => c.id === updated.id ? updated : c))`)
  so the already-selected buyer/supplier picks up the new details without a full refetch.

## Testing

- **Feature 1:** unit-level behavior is simple enough to cover directly in each screen's
  existing test file — typing an amount recomputes rate; typing qty/rate still recomputes
  amount; qty=0 leaves rate unchanged.
- **Feature 2:** `LotSelect.tsx` screen test — changing the date field refetches
  `listAvailableLots` with the new date and updates the "Today" caption; clicking Today
  resets to `today()`.
- **Feature 3:** `CustomerEditModal`/`SupplierEditModal` component tests (open, edit a
  field, save, confirm `updateCustomer`/`updateSupplier` called with expected payload,
  `onSaved` fires); a `NewSale.tsx`/`PurchaseForm.tsx` test confirming the Edit button
  appears once a party is chosen, opens the modal, and the info block reflects a saved
  change without navigating away.

## Out of scope

- Adding new customers/suppliers from within the Sale/Purchase form (this spec is edit
  only, for the already-selected party) — a natural follow-up, not requested here.
- A decoupled "preview stock as of a date without committing" mode for feature 2 (see
  note above) — flagged as a rejected alternative, not building it unless asked.
