# Granule Trader — Mantine UI Migration Design Spec

**Date:** 2026-06-25
**Status:** Draft for review

## 1. Purpose

The current UI is hand-rolled CSS (`theme.css` + bespoke components), which reads
as inconsistent and rough. Migrate the presentation layer to the **Mantine**
component library for a clean, consistent, professional CRM look — incrementally,
screen by screen, with the app fully usable throughout.

## 2. Scope and non-goals

**In scope:** adopt Mantine + a senior-friendly theme; an AppShell/Navbar; toast
notifications; re-skin the shared form/layout components on Mantine (preserving
their prop APIs); migrate every screen's layout/tables/inputs to Mantine; remove
the obsolete custom CSS at the end.

**Explicitly unchanged (non-goals):** the data layer (`window.api`, preload, IPC),
all main-process core logic (tax, numbering, stock draw-down, migrations,
backups), SQLite schema, business rules, and React Router routing. No behavior
changes — this is presentation only. No new features.

## 3. Decisions (locked)

- **Library:** Mantine (latest stable, v7+): `@mantine/core`, `@mantine/hooks`,
  `@mantine/dates` (+ `dayjs`), `@mantine/notifications`, and `@tabler/icons-react`.
- **Rollout:** incremental — foundation first, then shared components, then one
  screen per task. The app stays working after every task.
- **Senior-friendly + light:** keep the large-text, high-contrast, white-input
  direction via the Mantine theme (`forceColorScheme="light"`, scaled font sizes).

## 4. Foundation + theme

- `src/renderer/main.tsx` (or `App.tsx`) wraps everything in `<MantineProvider
  theme={theme}>` + `<Notifications />`, importing Mantine's CSS
  (`@mantine/core/styles.css`, `@mantine/dates/styles.css`,
  `@mantine/notifications/styles.css`).
- **Theme** (`src/renderer/theme.ts`): `forceColorScheme: 'light'`, a calm
  `primaryColor`, default `radius: 'md'`, and a scaled-up `fontSizes` map (base
  ~17–18px) plus larger control sizes (default `size="md"`/`"lg"` on inputs and
  buttons) for senior readability. Mantine light-scheme inputs are white with
  dark text by default, satisfying the OS-dark-mode requirement.
- **Shell:** replace `.app/.sidebar/.content` with Mantine `AppShell` +
  `AppShell.Navbar` containing `NavLink`s (Dashboard, Purchases, Sales, Stock,
  Customers, Settings) with `@tabler` icons; `AppShell.Main` renders the routes.
- **Feedback:** `@mantine/notifications` `notifications.show(...)` for success
  ("Saved") and errors (replacing most inline `error-banner`s); field-level
  validation stays inline via each input's `error` prop.

## 5. Shared components, re-skinned on Mantine (same APIs)

Rebuild internals on Mantine while keeping the existing prop signatures so screens
change minimally:

| Component | Mantine basis | API kept |
|---|---|---|
| `MoneyInput` | `NumberInput` (min 0, 2 decimals) | `{ value:number; onChange:(n)=>void; id? }` |
| `SignedMoneyInput` | `NumberInput` (allowNegative) | same |
| `StateSelect` | `Select` (searchable, data=`INDIAN_STATES`) | `{ value; onChange:(s)=>void; id? }` |
| `PincodeField` | `TextInput` (numeric, maxLength 6) + `lookupPincode` | `{ value; onChange; onResolved; id? }` |
| `PageHeader` | `Group`+`Title`+optional action | `{ title; action?; back? }` |
| `FormSection` | `Stack`/`Title`/`Divider`/`SimpleGrid` | `{ title; children }` |
| `FormPage` | `Container`/`Paper` + footer `Group` | `{ title; onBack; error?; footer; children }` |
| `TaxSummary` | `Table`/`Group` rows | `{ taxable; rows; total }` |
| `KpiCard` | `Card`+`Text` | `{ label; value }` |
| `ListTable` *(new)* | `Table` (striped, highlightOnHover, sticky header) | thin helper used by registers/ledgers |

Date fields (`<input type="date">`) → Mantine `DateInput` (value as `YYYY-MM-DD`
string via `valueFormat`/parsing helpers in `lib/format.ts`).

Form validation logic (the existing `errs`/`valid` maps) is kept; errors are
rendered through Mantine inputs' `error` prop rather than the bespoke `F()` helper.

## 6. Per-screen migration (one task each)

Order (each leaves the app fully working): **Dashboard → Customers list →
CustomerForm → Purchases list → PurchaseForm → Sales register → NewSale → Stock
ledger → StockAdjust → Settings → FirstRun (onboarding) → InvoiceView/template.**

Each task: replace the screen's custom markup/classes with Mantine layout
(`Stack`/`Group`/`Grid`/`Paper`), tables with `ListTable`/`Table`, buttons with
`Button`, status pills with `Badge`, confirmations with the existing `confirm()`
or a Mantine modal, and surface save/delete outcomes via notifications. The
screen's data/logic and `window.api` calls are unchanged.

## 7. Invoice (print fidelity)

The on-screen `InvoiceView` chrome (the Print/Back buttons, page frame) uses
Mantine, but the **printable invoice block (`InvoiceTemplate` + `invoice.css`)
stays plain HTML/CSS** so `window.print()` / Save-as-PDF output remains clean and
predictable. The template's structure (per-line HSN, HSN-wise summary) is
unchanged.

## 8. Testing

- All logic/core tests (currently 93) are unaffected and must stay green.
- Component tests that assert on DOM (`money-input`, `signed-money-input`,
  `state-select`, `invoice-template`, `sidebar`) are updated per component as it
  is re-skinned, because Mantine renders different DOM (e.g. `Select` is a custom
  combobox, not a native `<select>`; `NumberInput` is a `textbox` with formatting).
  Each re-skin task updates its own component test to query Mantine's DOM (and
  must wrap renders in `<MantineProvider>` in the test).
- No new business-logic tests (no logic change). Screens are verified by typecheck
  + the suite staying green + the operator's manual pass.

## 9. Constraints

- Keep the app working after every task (incremental); never a half-broken merge.
- Preserve senior-friendly readability (large fonts, big targets) via the theme.
- Renderer still reaches data only via `window.api.*`; no Mantine code in main/
  preload.
- Electron + Vite: Mantine works with `@vitejs/plugin-react`; ensure the styles
  imports and `postcss` (Mantine v7 uses a small `postcss-preset-mantine`) are
  configured in the renderer build.

## 10. Open items

- Exact Mantine version + whether `postcss-preset-mantine` is needed (Mantine v7
  recommends it for `rem()`/breakpoints; resolved at foundation task).
- Whether to adopt `@mantine/form` later (out of scope now; current validation
  logic is reused).
