# Suppliers Entity + Purchase Supplier Picker — Design Spec

**Date:** 2026-06-25
**Status:** Draft for review
**Sub-project:** A of the supplier/sale refinement batch (B = sale form fixes, merged; C = plain-English error sweep — separate spec).

## 1. Purpose

Today a purchase types the supplier's name and address as free text, fresh every
time. Make suppliers a **master record** — exactly like customers — so a purchase is
created by **picking a saved supplier** whose details prefill **read-only**. Supplier
details are edited only on the Suppliers screen, never inside a purchase.

This mirrors the interaction the buyer already has on a sale: type a name → it
auto-suggests → pick one → its GSTIN/address show read-only.

## 2. Decisions (locked)

- **Suppliers are a master entity** with full CRUD and their own screen, mirroring
  Customers. A supplier has a **single address** (no billing/shipping split — we don't
  ship to a supplier).
- **GSTIN is mandatory** for every supplier; **PAN auto-derives from it, read-only**
  (`panFromGstin`); **phone is mandatory** (10-digit). Name, state, city, pincode, and
  address are required too (pincode 6-digit, auto-fills city/state).
- **A purchase must reference a saved supplier.** The free-text supplier inputs are
  replaced by a **searchable supplier picker**; the chosen supplier's details show
  read-only. To add a supplier you don't have yet, use the Suppliers screen (no inline
  quick-add in v1 — consistent with how a sale already requires an existing customer).
- **Snapshot on save (mirrors sales→buyer).** The purchase stores `supplier_id` **and**
  a snapshot of the supplier's details in its existing `party*` columns, so a later
  edit to the supplier never alters a past purchase record. The supplier's state drives
  the existing CGST/SGST-vs-IGST tax logic, unchanged.
- **Development phase: the database may be reset.** No legacy-data migration or
  legacy-purchase handling is required. `supplier_id` is a required (NOT NULL) column
  on `purchases` from the start.

## 3. Data model

New table (added to `src/main/db/schema.ts` `SCHEMA_SQL`):

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

`purchases` gains one column:

```sql
supplier_id INTEGER NOT NULL DEFAULT 0 REFERENCES suppliers(id)
```

Added to the `CREATE TABLE purchases` definition for fresh databases, plus an
idempotent `ALTER TABLE purchases ADD COLUMN supplier_id INTEGER NOT NULL DEFAULT 0`
in `migrate()` (harmless safety for any un-wiped dev DB; `0` = "no supplier", which
cannot occur via the UI because the picker is required). The `party*` snapshot columns
(`party`, `party_state`, `party_city`, `party_pincode`, `party_address`) are unchanged.

## 4. Types & API (mirror customers)

- `src/shared/types.ts` — new `Supplier` interface:
  `{ id, name, gstin, pan, phone, address, city, state, pincode }`. `Purchase` gains
  `supplier_id: number`.
- `src/shared/api.ts` — add to `Api` and `CHANNELS`:
  `listSuppliers(search?: string): Promise<Supplier[]>`, `createSupplier(s: Omit<Supplier,'id'>): Promise<Supplier>`,
  `updateSupplier(id, s): Promise<Supplier>`, `deleteSupplier(id): Promise<void>`.
- The preload bridge is `CHANNELS`-driven, so adding the four channels wires preload
  automatically; the API-guard test is updated to expect the new channels.

## 5. Core module (`src/main/core/suppliers.ts`)

A direct mirror of `customers.ts`, minus shipping and `placeOfSupplyState`:

```ts
const COLS = `name, gstin, pan, phone, address, city, state, pincode`
createSupplier(db, s): Supplier      // INSERT, returns getSupplier(lastInsertRowid)
updateSupplier(db, id, s): Supplier  // UPDATE ... WHERE id=@id, returns getSupplier(id)
getSupplier(db, id): Supplier | undefined
listSuppliers(db, search?): Supplier[]   // WHERE name LIKE ? OR gstin LIKE ? ORDER BY name; else all ORDER BY name
deleteSupplier(db, id): void
```

IPC handlers in `src/main/ipc.ts` mirror the customer block
(`h('listSuppliers', …)`, etc.).

## 6. Suppliers screens

- `src/renderer/screens/Suppliers.tsx` — list with search + "+ Add supplier", an Edit /
  Delete row action, columns Name · GSTIN · City · State. Copied from `Customers.tsx`.
- `src/renderer/screens/SupplierForm.tsx` — add/edit form. Copied from `CustomerForm.tsx`
  but **single address** (no shipping checkbox/section). Fields: Name\*, GSTIN\* (→ PAN
  read-only), Phone\*, then Pincode (auto-fills) · City\* · State\* · Address\*. Save via
  `createSupplier`/`updateSupplier`, success toast, back to `/suppliers`.
- Routing (`src/renderer/routes.tsx`): `/suppliers`, `/suppliers/new`, `/suppliers/edit/:id`.
- Nav (`src/renderer/components/Sidebar.tsx`): a **Suppliers** item (e.g.
  `IconBuildingWarehouse` or `IconTruck`) placed after Customers.

## 7. Purchase form change (`src/renderer/screens/PurchaseForm.tsx`)

- Load suppliers via `window.api.listSuppliers()` into state.
- Replace the "Supplier" `FormSection`'s free-text name + pincode/city/state/address
  inputs with **one searchable `Select`** (Mantine, `searchable`), data =
  `suppliers.map(s => ({ value: String(s.id), label: s.name + (s.gstin ? ` (${s.gstin})` : '') }))`,
  labelled "Supplier", `withAsterisk`, required.
- On selection, render a **read-only details block** (same style as the sale's buyer
  block): GSTIN, phone, and `address, city, state — pincode`, plus a muted note
  "To edit these, open the Suppliers screen."
- Form state holds `supplier_id` (number | null). `errs.supplier` = required.
  `party_state` for the tax preview comes from the selected supplier's `state`.
- On save, the payload sets `supplier_id` and snapshots the supplier's fields into
  `party`, `party_state`, `party_city`, `party_pincode`, `party_address`. On edit, the
  picker preselects the purchase's `supplier_id`.
- `NewPurchase` (`src/main/core/purchase.ts`) gains `supplier_id: number`;
  `createPurchase`/`updatePurchase` persist it (the `party*` snapshot is already passed
  through). No change to tax, numbering, or draw-down.

## 8. Out of scope

- The app-wide plain-English error sweep (sub-project C), including the shared
  `formatAddress` helper that would de-duplicate the address-join now repeated in the
  sale buyer block, the purchase supplier block, and the invoice template.
- Inline "add supplier" without leaving the purchase form.
- Any change to tax, numbering, stock draw-down, sales, or the invoice template.

## 9. Testing

- **`tests/main/suppliers.test.ts`** (mirrors the customer-core test): create → get
  round-trips all fields; update mutates; `listSuppliers` returns ordered-by-name and
  filters by search (name and GSTIN); delete removes. Uses the same in-memory/temp DB
  harness the customer test uses.
- **Schema test:** after `initSchema`, `suppliers` table exists and `purchases` has a
  `supplier_id` column (PRAGMA check), in whichever existing schema/migration test file
  covers the customer/purchase tables.
- **API-guard test** updated: the new four channels are present and bridged.
- A purchase created with a `supplier_id` + snapshot round-trips through
  `createPurchase`/`listPurchases` with `supplier_id` intact (extend the purchase-core
  test).
- Full existing suite stays green; `npm run typecheck` + `npm run build` clean. The
  Suppliers screens and the purchase picker are verified by typecheck + suite + the
  operator's manual pass (type a supplier name → suggestions → pick → read-only details;
  Save blocked until a supplier is chosen).

## 10. Open items

None.
