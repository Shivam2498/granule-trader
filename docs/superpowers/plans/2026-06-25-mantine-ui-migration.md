# Mantine UI Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the Granule Trader renderer UI from hand-rolled CSS to the Mantine component library, incrementally, with the app fully usable after every task.

**Architecture:** Add Mantine + a senior-friendly light theme and an AppShell/Navbar; re-skin the shared form/layout components on Mantine while preserving their prop APIs (so screens improve immediately); then migrate each screen's tables/layout/inputs to Mantine. The data layer (`window.api`, main-process core, SQLite) and routing are untouched.

**Tech Stack:** Electron, electron-vite, React 18, TypeScript, Mantine v7 (`@mantine/core`, `@mantine/hooks`, `@mantine/dates`, `@mantine/notifications`), `@tabler/icons-react`, Vitest, `@testing-library/react`.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-25-mantine-ui-migration-design.md` is authoritative.
- **Presentation only:** NO changes to `window.api`, preload, main-process core/db, business logic, or routing. No behavior changes; no new features.
- **App stays working every task:** after each task `npm test` + `npm run typecheck` + `npm run build` pass, and the app renders (foundation switches the shell; screens render their existing content inside it).
- **Senior-friendly + light:** Mantine theme `forceColorScheme="light"`, scaled-up font sizes, default input/button `size="md"`. White inputs + dark text (Mantine light default).
- **Renderer-only:** Mantine appears only under `src/renderer`. Main/preload stay free of Mantine.
- **Tests:** logic/core tests (93) stay green untouched. Component tests for re-skinned components are updated to Mantine's DOM and wrapped in `<MantineProvider>` (via a shared test helper). No new business-logic tests.
- **Invoice print fidelity:** `InvoiceTemplate` + `invoice.css` (the printable block) stay plain HTML/CSS; only the surrounding `InvoiceView` chrome uses Mantine.
- **Non-editable fields show as disabled:** any computed / read-only field (e.g. the Taxable amount = qty×rate, the chosen data-folder path) uses Mantine's `disabled` prop (clearly greyed and non-focusable), NOT `readOnly`. They still display their value.
- **Shared component APIs preserved:** `MoneyInput`/`SignedMoneyInput` `{value:number,onChange:(n)=>void,id?}`; `StateSelect` `{value,onChange:(s)=>void,id?}`; `PincodeField` `{value,onChange,onResolved,id?}`; `FormPage` `{title,onBack,error?,footer,children}`; `FormSection` `{title,children}`; `PageHeader` `{title,action?,back?}`; `TaxSummary` `{taxable,rows,total}`; `KpiCard` `{label,value}`.

---

## File Structure

**Foundation:** `package.json` (deps), `postcss.config.cjs` (new), `src/renderer/theme.ts` (new — Mantine theme), `src/renderer/main.tsx` (provider + styles), `src/renderer/App.tsx` (AppShell), `src/renderer/components/Sidebar.tsx` (AppShell.Navbar links).
**Test helper:** `tests/renderer/mantine.tsx` (new — `renderWithMantine`).
**Shared components (re-skinned, same APIs):** `MoneyInput`, `SignedMoneyInput`, `StateSelect`, `PincodeField`, `PageHeader`, `FormSection`, `FormPage`, `TaxSummary`, `KpiCard`, plus a new `ListTable`.
**Screens (per task):** Dashboard, Customers + CustomerForm, Purchases + PurchaseForm, Sales + NewSale, Stock + StockAdjust, Settings, FirstRun, InvoiceView. `InvoiceTemplate`/`invoice.css` unchanged.
**Cleanup:** `src/renderer/theme.css` (remove once unused).

---

## Phase A — Foundation

### Task 1: Install Mantine, provider, theme, AppShell, notifications

**Files:**
- Modify: `package.json`, `electron.vite.config.ts`, `src/renderer/main.tsx`, `src/renderer/App.tsx`, `src/renderer/components/Sidebar.tsx`
- Create: `postcss.config.cjs`, `src/renderer/theme.ts`, `tests/renderer/mantine.tsx`
- Test: update `tests/renderer/sidebar.test.tsx`

**Interfaces:**
- Produces: a Mantine-wrapped app (`MantineProvider` + `Notifications` mounted in `main.tsx`), the `theme` object, an `AppShell` layout with a Navbar, and `renderWithMantine(ui)` for component tests.

- [ ] **Step 1: Install dependencies**

Run:
```bash
npm install @mantine/core @mantine/hooks @mantine/dates @mantine/notifications dayjs @tabler/icons-react
npm install -D postcss postcss-preset-mantine postcss-simple-vars
```

- [ ] **Step 2: PostCSS config for Mantine** — create `postcss.config.cjs`:

```js
module.exports = {
  plugins: {
    'postcss-preset-mantine': {},
    'postcss-simple-vars': {
      variables: {
        'mantine-breakpoint-xs': '36em',
        'mantine-breakpoint-sm': '48em',
        'mantine-breakpoint-md': '62em',
        'mantine-breakpoint-lg': '75em',
        'mantine-breakpoint-xl': '88em'
      }
    }
  }
}
```

- [ ] **Step 3: The theme** — create `src/renderer/theme.ts`:

```ts
import { createTheme } from '@mantine/core'

// Senior-friendly: larger base text, comfortable controls, calm blue primary.
export const theme = createTheme({
  primaryColor: 'blue',
  defaultRadius: 'md',
  fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
  fontSizes: { xs: '14px', sm: '16px', md: '17px', lg: '19px', xl: '22px' },
  headings: { sizes: { h1: { fontSize: '28px' }, h2: { fontSize: '22px' }, h3: { fontSize: '18px' } } },
  components: {
    TextInput: { defaultProps: { size: 'md' } },
    NumberInput: { defaultProps: { size: 'md' } },
    Select: { defaultProps: { size: 'md' } },
    Textarea: { defaultProps: { size: 'md' } },
    Button: { defaultProps: { size: 'md' } }
  }
})
```

- [ ] **Step 4: Mount the provider** — replace `src/renderer/main.tsx`:

```tsx
import { createRoot } from 'react-dom/client'
import { MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import '@mantine/core/styles.css'
import '@mantine/dates/styles.css'
import '@mantine/notifications/styles.css'
import { theme } from './theme'
import App from './App'

createRoot(document.getElementById('root')!).render(
  <MantineProvider theme={theme} forceColorScheme="light">
    <Notifications position="top-right" />
    <App />
  </MantineProvider>
)
```

- [ ] **Step 5: AppShell** — replace `src/renderer/App.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { HashRouter } from 'react-router-dom'
import { AppShell, Loader, Center } from '@mantine/core'
import Sidebar from './components/Sidebar'
import AppRoutes from './routes'
import FirstRun from './screens/FirstRun'

export default function App() {
  const [ready, setReady] = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  useEffect(() => { window.api.needsSetup().then(n => { setNeedsSetup(n); setReady(true) }) }, [])
  if (!ready) return <Center h="100vh"><Loader /></Center>
  if (needsSetup) return <FirstRun onDone={() => setNeedsSetup(false)} />
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppShell navbar={{ width: 240, breakpoint: 'sm' }} padding="lg">
        <AppShell.Navbar p="md"><Sidebar /></AppShell.Navbar>
        <AppShell.Main><AppRoutes /></AppShell.Main>
      </AppShell>
    </HashRouter>
  )
}
```

- [ ] **Step 6: Navbar links** — replace `src/renderer/components/Sidebar.tsx`:

```tsx
import { NavLink as RouterNavLink, useLocation } from 'react-router-dom'
import { NavLink, Title, Stack } from '@mantine/core'
import { IconDashboard, IconShoppingCart, IconReceipt, IconBox, IconUsers, IconSettings } from '@tabler/icons-react'

const items = [
  { to: '/', label: 'Dashboard', icon: IconDashboard },
  { to: '/purchases', label: 'Purchases', icon: IconShoppingCart },
  { to: '/sales', label: 'Sales', icon: IconReceipt },
  { to: '/stock', label: 'Stock', icon: IconBox },
  { to: '/customers', label: 'Customers', icon: IconUsers },
  { to: '/settings', label: 'Settings', icon: IconSettings }
]

export default function Sidebar() {
  const loc = useLocation()
  return (
    <Stack gap="xs">
      <Title order={3} mb="sm">Granule Trader</Title>
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} component={RouterNavLink} to={to} label={label}
          leftSection={<Icon size={20} />}
          active={to === '/' ? loc.pathname === '/' : loc.pathname.startsWith(to)} />
      ))}
    </Stack>
  )
}
```

- [ ] **Step 7: Test helper** — create `tests/renderer/mantine.tsx`:

```tsx
import type { ReactElement } from 'react'
import { render } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { theme } from '../../src/renderer/theme'

export function renderWithMantine(ui: ReactElement) {
  return render(<MantineProvider theme={theme} forceColorScheme="light">{ui}</MantineProvider>)
}
```

- [ ] **Step 8: Update the sidebar test** — replace `tests/renderer/sidebar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { HashRouter } from 'react-router-dom'
import { renderWithMantine } from './mantine'
import Sidebar from '../../src/renderer/components/Sidebar'

describe('Sidebar', () => {
  it('shows all six navigation items', () => {
    renderWithMantine(<HashRouter><Sidebar /></HashRouter>)
    for (const label of ['Dashboard','Purchases','Sales','Stock','Customers','Settings'])
      expect(screen.getByText(label)).toBeTruthy()
  })
})
```

- [ ] **Step 9: Verify**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green. The renderer bundle now includes Mantine; the app boots into the AppShell with the existing screens rendering inside `AppShell.Main` (they still use `theme.css` classes, which remain defined until Phase D — both stylesheets coexist).

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json postcss.config.cjs electron.vite.config.ts src/renderer/theme.ts src/renderer/main.tsx src/renderer/App.tsx src/renderer/components/Sidebar.tsx tests/renderer/mantine.tsx tests/renderer/sidebar.test.tsx
git commit -m "feat: Mantine foundation — provider, theme, AppShell, navbar, notifications, test helper"
```

> Note: `electron.vite.config.ts` needs no change for Mantine beyond what exists (Vite auto-detects `postcss.config.cjs`). It is listed in `git add` only if you touched it; if untouched, drop it from the commit.

---

## Phase B — Shared components re-skinned on Mantine (same prop APIs)

> These keep their exact public props so the screens that already use them improve immediately. Each `.test.tsx` is updated to render via `renderWithMantine` (Task 1's helper) and to query Mantine's DOM. Mantine `NumberInput` and `TextInput` render an `<input role="textbox">`; Mantine `Select` renders an `<input role="textbox">` (a combobox-style input), NOT a native `<select>` — tests are updated accordingly.

### Task 2: Number/select/pincode inputs

**Files:**
- Modify: `src/renderer/components/MoneyInput.tsx`, `SignedMoneyInput.tsx`, `StateSelect.tsx`, `PincodeField.tsx`
- Test: update `tests/renderer/money-input.test.tsx`, `signed-money-input.test.tsx`, `state-select.test.tsx`

**Interfaces:**
- Consumes: `renderWithMantine` (tests), `INDIAN_STATES`, `lookupPincode`.
- Produces (unchanged prop APIs): `MoneyInput`/`SignedMoneyInput` `{value:number,onChange:(n:number)=>void,id?}`; `StateSelect` `{value:string,onChange:(s:string)=>void,id?}`; `PincodeField` `{value:string,onChange:(s:string)=>void,onResolved:(r:{city,state})=>void,id?}`.

- [ ] **Step 1: Implement `MoneyInput.tsx`** (Mantine `NumberInput`, non-negative)

```tsx
import { NumberInput } from '@mantine/core'
export default function MoneyInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  return (
    <NumberInput id={id} value={value === 0 ? '' : value} min={0} decimalScale={2} step={1} hideControls allowNegative={false} thousandSeparator=","
      onChange={v => onChange(typeof v === 'number' ? v : (v === '' ? 0 : Number(v)))} />
  )
}
```

- [ ] **Step 2: Implement `SignedMoneyInput.tsx`** (allows negative)

```tsx
import { NumberInput } from '@mantine/core'
export default function SignedMoneyInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  return (
    <NumberInput id={id} value={value === 0 ? '' : value} decimalScale={2} step={1} hideControls allowNegative
      onChange={v => onChange(typeof v === 'number' ? v : (v === '' ? 0 : Number(v)))} />
  )
}
```

- [ ] **Step 3: Implement `StateSelect.tsx`** (Mantine `Select`, searchable)

```tsx
import { Select } from '@mantine/core'
import { INDIAN_STATES } from '@shared/indian-states'
export default function StateSelect({ value, onChange, id }: { value: string; onChange: (s: string) => void; id?: string }) {
  return (
    <Select id={id} data={INDIAN_STATES} value={value || null} searchable nothingFoundMessage="No match"
      placeholder="Select state" onChange={v => onChange(v ?? '')} />
  )
}
```

- [ ] **Step 4: Implement `PincodeField.tsx`** (Mantine `TextInput`)

```tsx
import { TextInput } from '@mantine/core'
import { lookupPincode } from '../lib/pincode'
export default function PincodeField({ value, onChange, onResolved, id }:
  { value: string; onChange: (s: string) => void; onResolved: (r: { city: string; state: string }) => void; id?: string }) {
  return (
    <TextInput id={id} inputMode="numeric" maxLength={6} value={value}
      onChange={e => {
        const v = e.currentTarget.value.replace(/\D/g, '').slice(0, 6)
        onChange(v)
        if (v.length === 6) { const r = lookupPincode(v); if (r) onResolved(r) }
      }} />
  )
}
```

- [ ] **Step 5: Update the tests**

`tests/renderer/money-input.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import MoneyInput from '../../src/renderer/components/MoneyInput'

describe('MoneyInput', () => {
  it('reports a number on change and treats empty as 0', () => {
    const onChange = vi.fn()
    renderWithMantine(<MoneyInput value={0} onChange={onChange} id="amt" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '1234.5' } })
    expect(onChange).toHaveBeenCalledWith(1234.5)
    fireEvent.change(input, { target: { value: '' } })
    expect(onChange).toHaveBeenCalledWith(0)
  })
})
```

`tests/renderer/signed-money-input.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import SignedMoneyInput from '../../src/renderer/components/SignedMoneyInput'

describe('SignedMoneyInput', () => {
  it('accepts a negative value', () => {
    const onChange = vi.fn()
    renderWithMantine(<SignedMoneyInput value={0} onChange={onChange} id="ro" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.change(input, { target: { value: '-0.4' } })
    expect(onChange).toHaveBeenCalledWith(-0.4)
  })
})
```

`tests/renderer/state-select.test.tsx`:
```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import StateSelect from '../../src/renderer/components/StateSelect'

describe('StateSelect', () => {
  it('opens the dropdown and reports the chosen state', () => {
    const onChange = vi.fn()
    renderWithMantine(<StateSelect value="" onChange={onChange} id="st" />)
    const input = screen.getByRole('textbox') as HTMLInputElement
    fireEvent.click(input)                      // open the Mantine Select dropdown
    fireEvent.click(screen.getByText('Gujarat'))
    expect(onChange).toHaveBeenCalledWith('Gujarat')
  })
})
```

> If Mantine's `NumberInput`/`Select` `onChange` value shape differs in the installed version (e.g. emits a string for partial input), keep the wrapper's coercion (`typeof v === 'number' ? v : Number(v)`) so the asserted number still holds; adjust the test's `fireEvent` only if the DOM event differs. Confirm the exact behavior by running the focused test.

- [ ] **Step 6: Run the tests + suite**

Run: `npx vitest run tests/renderer/money-input.test.tsx tests/renderer/signed-money-input.test.tsx tests/renderer/state-select.test.tsx && npm test && npm run typecheck`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/MoneyInput.tsx src/renderer/components/SignedMoneyInput.tsx src/renderer/components/StateSelect.tsx src/renderer/components/PincodeField.tsx tests/renderer/money-input.test.tsx tests/renderer/signed-money-input.test.tsx tests/renderer/state-select.test.tsx
git commit -m "feat: re-skin number/select/pincode inputs on Mantine (same APIs)"
```

---

### Task 3: Layout components + ListTable

**Files:**
- Modify: `src/renderer/components/PageHeader.tsx`, `FormSection.tsx`, `FormPage.tsx`
- Create: `src/renderer/components/ListTable.tsx`
- Test: none (verified via typecheck + suite + the screens that consume them)

**Interfaces:**
- Produces:
  - `PageHeader({ title:string, action?:ReactNode, back?:()=>void })`
  - `FormSection({ title:string, children:ReactNode })`
  - `FormPage({ title:string, onBack:()=>void, error?:string, footer:ReactNode, children:ReactNode })`
  - `ListTable({ head:ReactNode, children:ReactNode })` — a styled Mantine `Table` wrapper (striped, hover); `head` is the `<Table.Tr>` of `<Table.Th>`s, `children` are the body `<Table.Tr>`s.

- [ ] **Step 1: `PageHeader.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Group, Title, Button } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
export default function PageHeader({ title, action, back }: { title: string; action?: ReactNode; back?: () => void }) {
  return (
    <Group justify="space-between" mb="lg" wrap="nowrap">
      <Group gap="xs">
        {back && <Button variant="subtle" leftSection={<IconChevronLeft size={18} />} onClick={back} px="xs">Back</Button>}
        <Title order={1}>{title}</Title>
      </Group>
      {action}
    </Group>
  )
}
```

- [ ] **Step 2: `FormSection.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Stack, Title, Divider, SimpleGrid } from '@mantine/core'
export default function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs" mb="lg">
      <Title order={3}>{title}</Title>
      <Divider />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">{children}</SimpleGrid>
    </Stack>
  )
}
```

> A field that should span both columns wraps its control in `<div style={{ gridColumn: '1 / -1' }}>…</div>` (the screens already pass full-width fields; they use this wrapper).

- [ ] **Step 3: `FormPage.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Paper, Group, Alert } from '@mantine/core'
import PageHeader from './PageHeader'
export default function FormPage({ title, onBack, error, footer, children }:
  { title: string; onBack: () => void; error?: string; footer: ReactNode; children: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} back={onBack} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">{children}</Paper>
      <Group justify="flex-end" mt="md">{footer}</Group>
    </div>
  )
}
```

- [ ] **Step 4: `ListTable.tsx`**

```tsx
import type { ReactNode } from 'react'
import { Table } from '@mantine/core'
export default function ListTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
      <Table.Thead><Table.Tr>{head}</Table.Tr></Table.Thead>
      <Table.Tbody>{children}</Table.Tbody>
    </Table>
  )
}
```

- [ ] **Step 5: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
Expected: green (these are additive; screens still reference them with the same props — `FormPage`/`FormSection`/`PageHeader` keep their signatures, so the form screens render through Mantine now).
```bash
git add src/renderer/components/PageHeader.tsx src/renderer/components/FormSection.tsx src/renderer/components/FormPage.tsx src/renderer/components/ListTable.tsx
git commit -m "feat: re-skin PageHeader/FormSection/FormPage + add ListTable on Mantine"
```

---

### Task 4: TaxSummary, KpiCard, and date helper

**Files:**
- Modify: `src/renderer/components/TaxSummary.tsx`, `src/renderer/components/KpiCard.tsx`
- Create: `src/renderer/components/DateField.tsx`
- Test: none

**Interfaces:**
- Produces:
  - `TaxSummary({ taxable:number, rows:{label:string;value:number}[], total:number })`
  - `KpiCard({ label:string, value:string })`
  - `DateField({ value:string, onChange:(s:string)=>void, id? })` — Mantine `DateInput` bound to a `YYYY-MM-DD` string (empty string ↔ null).

- [ ] **Step 1: `TaxSummary.tsx`**

```tsx
import { Stack, Group, Text, Divider } from '@mantine/core'
import { formatINR } from '../lib/format'
export default function TaxSummary({ taxable, rows, total }:
  { taxable: number; rows: { label: string; value: number }[]; total: number }) {
  return (
    <Stack gap={4} maw={360} ml="auto">
      <Group justify="space-between"><Text c="dimmed">Taxable</Text><Text>{formatINR(taxable)}</Text></Group>
      {rows.map(r => (
        <Group key={r.label} justify="space-between"><Text c="dimmed">{r.label}</Text><Text>{formatINR(r.value)}</Text></Group>
      ))}
      <Divider my={4} />
      <Group justify="space-between"><Text fw={700}>Net total</Text><Text fw={700} size="lg">{formatINR(total)}</Text></Group>
    </Stack>
  )
}
```

- [ ] **Step 2: `KpiCard.tsx`**

```tsx
import { Paper, Text } from '@mantine/core'
export default function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="lg" radius="md" style={{ flex: 1, minWidth: 200 }}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="28px">{value}</Text>
    </Paper>
  )
}
```

- [ ] **Step 3: `DateField.tsx`** (string-bound `DateInput`)

```tsx
import { DateInput } from '@mantine/dates'
export default function DateField({ value, onChange, id }: { value: string; onChange: (s: string) => void; id?: string }) {
  return (
    <DateInput id={id} valueFormat="YYYY-MM-DD"
      value={value ? new Date(value + 'T00:00:00') : null}
      onChange={d => onChange(d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')} />
  )
}
```

- [ ] **Step 4: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/components/TaxSummary.tsx src/renderer/components/KpiCard.tsx src/renderer/components/DateField.tsx
git commit -m "feat: re-skin TaxSummary/KpiCard on Mantine + string-bound DateField"
```

---

## Phase C — Screens (one task each; app stays working)

> **Form screens** (CustomerForm, PurchaseForm, NewSale, FirstRun, Settings, StockAdjust) already use the re-skinned shared components (`FormPage`, `FormSection`, `MoneyInput`, `SignedMoneyInput`, `StateSelect`, `PincodeField`, `TaxSummary`) — so they render through Mantine after Phase B. Their remaining work is swapping the **raw** elements per this mapping (preserve ALL existing hooks, handlers, validation logic, and `window.api` calls verbatim — only the presentational elements change):
>
> | Current | Replace with (Mantine) |
> |---|---|
> | `<input value onChange placeholder />` | `<TextInput value onChange placeholder error={…} />` |
> | `<input readOnly …/>` (computed/non-editable) | `<TextInput disabled value={…} label="…" />` (greyed, not `readOnly`) |
> | `<input type="date" …/>` | `<DateField value onChange />` (Task 4) |
> | `<select value onChange><option/></select>` | `<Select value={v||null} onChange={x=>set(x??'')} data={[{value,label}]} />` |
> | `<textarea …/>` | `<Textarea …/>` |
> | `<button className="primary">` | `<Button>` |
> | `<button>` (secondary) | `<Button variant="default">` |
> | `<button className="link">` | `<Button variant="subtle" size="compact-sm">` |
> | `<button className="link danger">` | `<Button variant="subtle" color="red" size="compact-sm">` |
> | `<div className="error-banner">{e}</div>` | `<Alert color="red" mb="md">{e}</Alert>` |
> | `<span className="pill pending|done">` | `<Badge color={done?'green':'orange'}>` |
> | `<div className="card">` | `<Paper withBorder p="lg" radius="md" mb="md">` |
> | `<div className="row">` | `<Group>` (or `<SimpleGrid>`) |
> | the `field` inline-error `F()` helper | pass `error` to the Mantine input directly (drop the helper) |
> | `<input type="checkbox">` + label | `<Checkbox label=… checked onChange />` |
> | `alert/confirm` on save success | `notifications.show({ message: 'Saved', color: 'green' })` (keep `confirm()` for delete) |
>
> Each form-screen task imports the Mantine components it uses from `@mantine/core` (and `notifications` from `@mantine/notifications`) and is verified by `npm run typecheck` + the suite + `npm run build`. Do NOT run `npm run dev`.

### Task 5: Dashboard

**Files:** Modify `src/renderer/screens/Dashboard.tsx` (replace). Test: none.

- [ ] **Step 1: Replace `src/renderer/screens/Dashboard.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Group, Button, Paper, Title, Text, List, Alert, Stack } from '@mantine/core'
import type { Sale, Purchase, LedgerRow, Settings } from '@shared/types'
import KpiCard from '../components/KpiCard'
import PageHeader from '../components/PageHeader'
import { formatINR, today } from '../lib/format'

export default function Dashboard() {
  const nav = useNavigate()
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [ledger, setLedger] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      setSales(await window.api.listSales()); setPurchases(await window.api.listPurchases())
      setLedger(await window.api.stockLedger()); setSettings(await window.api.getSettings())
    } catch (e: any) { setError('Could not load dashboard: ' + (e.message ?? e)) }
  })() }, [])

  const month = today().slice(0, 7)
  const created = sales.filter(s => s.status === 'created')
  const salesTotal = created.filter(s => (s.invoice_date ?? '').startsWith(month)).reduce((a, s) => a + s.total_invoice_amount, 0)
  const stockOnHand = ledger.reduce((a, r) => a + r.balance_kg, 0)
  const pendingSales = created.filter(s => s.payment_status === 'pending')
  const pendingPurchases = purchases.filter(p => p.payment_status === 'pending')
  const low = settings?.low_stock_threshold ?? 0
  const lowLots = ledger.filter(r => r.balance_kg < low)

  return (
    <div>
      <PageHeader title={`Welcome${settings?.seller_name ? `, ${settings.seller_name}` : ''}`} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Text c="dimmed" mb="md">{today()}</Text>
      <Group mb="lg">
        <Button size="lg" onClick={() => nav('/sales/new')}>New sale</Button>
        <Button size="lg" variant="default" onClick={() => nav('/purchases/new')}>New purchase</Button>
      </Group>
      <Group align="stretch" mb="lg">
        <KpiCard label="Sales this month" value={formatINR(salesTotal)} />
        <KpiCard label="Stock on hand" value={`${stockOnHand} kg`} />
        <KpiCard label="Payments pending (sales)" value={String(pendingSales.length)} />
        <KpiCard label="Payments pending (purchases)" value={String(pendingPurchases.length)} />
      </Group>
      <Paper withBorder p="lg" radius="md" mb="md">
        <Title order={2} mb="sm">Low stock</Title>
        {lowLots.length === 0 ? <Text>Nothing below {low} kg.</Text> :
          <List>{lowLots.map(r => <List.Item key={r.purchase_id}>{r.our_code} ({r.hsn_code}) — {r.balance_kg} kg</List.Item>)}</List>}
      </Paper>
      <Paper withBorder p="lg" radius="md">
        <Title order={2} mb="sm">Pending sales payments</Title>
        {pendingSales.length === 0 ? <Text>All settled.</Text> :
          <List>{pendingSales.map(s => <List.Item key={s.id}>{s.invoice_number} — {s.buyer_name} — {formatINR(s.total_invoice_amount)}</List.Item>)}</List>}
      </Paper>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/Dashboard.tsx
git commit -m "feat: Dashboard on Mantine (cards, lists, buttons)"
```

---

### Task 6: Customers list

**Files:** Modify `src/renderer/screens/Customers.tsx` (replace). Test: none.

- [ ] **Step 1: Replace `src/renderer/screens/Customers.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, TextInput, Button, Alert, Group } from '@mantine/core'
import type { Customer } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { Table } from '@mantine/core'

export default function Customers() {
  const nav = useNavigate()
  const [list, setList] = useState<Customer[]>([])
  const [search, setSearch] = useState('')
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listCustomers(search || undefined)) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [search])
  async function remove(id: number) {
    if (!confirm('Delete this customer?')) return
    try { await window.api.deleteCustomer(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Customers" action={<Button onClick={() => nav('/customers/new')}>+ Add customer</Button>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <TextInput placeholder="Search by name or GSTIN" value={search} onChange={e => setSearch(e.currentTarget.value)} maw={380} mb="md" />
        <ListTable head={<><Table.Th>Name</Table.Th><Table.Th>GSTIN</Table.Th><Table.Th>City</Table.Th><Table.Th>State</Table.Th><Table.Th /></>}>
          {list.map(c => (
            <Table.Tr key={c.id}>
              <Table.Td>{c.name}</Table.Td><Table.Td>{c.gstin}</Table.Td><Table.Td>{c.billing_city}</Table.Td><Table.Td>{c.billing_state}</Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button variant="subtle" size="compact-sm" onClick={() => nav(`/customers/edit/${c.id}`)}>Edit</Button>
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => remove(c.id)}>Delete</Button>
                </Group>
              </Table.Td>
            </Table.Tr>))}
          {list.length === 0 && <Table.Tr><Table.Td colSpan={5} c="dimmed">No customers yet.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/Customers.tsx
git commit -m "feat: Customers list on Mantine (Table, Paper, Buttons)"
```

---

### Task 7: Sales register

**Files:** Modify `src/renderer/screens/Sales.tsx` (replace). Test: none.

- [ ] **Step 1: Replace `src/renderer/screens/Sales.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, Button, Alert, Badge, Group, Table, Text } from '@mantine/core'
import type { Sale } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { formatINR } from '../lib/format'

export default function Sales() {
  const nav = useNavigate()
  const [list, setList] = useState<Sale[]>([])
  const [error, setError] = useState('')
  async function reload() { try { setList(await window.api.listSales()) } catch (e: any) { setError(e.message ?? String(e)) } }
  useEffect(() => { reload() }, [])
  async function remove(id: number) {
    setError('')
    if (!confirm('Delete this sale? Stock will be restored.')) return
    try { await window.api.deleteSale(id); reload() } catch (e: any) { setError(e.message ?? String(e)) }
  }
  return (
    <div>
      <PageHeader title="Sales" action={<Button onClick={() => nav('/sales/new')}>+ New sale</Button>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <ListTable head={<><Table.Th>Invoice</Table.Th><Table.Th>Date</Table.Th><Table.Th>Buyer</Table.Th><Table.Th ta="right">Qty</Table.Th><Table.Th ta="right">Total</Table.Th><Table.Th>Payment</Table.Th><Table.Th /></>}>
          {list.map(s => s.status === 'reserved' ? (
            <Table.Tr key={s.id}>
              <Table.Td>{s.invoice_number}</Table.Td><Table.Td colSpan={4}><Text c="dimmed" fs="italic">reserved — blank</Text></Table.Td><Table.Td />
              <Table.Td><Button variant="subtle" size="compact-sm" onClick={() => nav(`/sales/fill/${s.id}`)}>Fill</Button></Table.Td>
            </Table.Tr>
          ) : (
            <Table.Tr key={s.id}>
              <Table.Td>{s.invoice_number}</Table.Td><Table.Td>{s.invoice_date}</Table.Td><Table.Td>{s.buyer_name}</Table.Td>
              <Table.Td ta="right">{s.total_qty_kg}</Table.Td><Table.Td ta="right">{formatINR(s.total_invoice_amount)}</Table.Td>
              <Table.Td><Badge color={s.payment_status === 'done' ? 'green' : 'orange'}>{s.payment_status}</Badge></Table.Td>
              <Table.Td>
                <Group gap="xs" justify="flex-end">
                  <Button variant="subtle" size="compact-sm" onClick={() => nav(`/invoice/${s.id}`)}>Preview / PDF</Button>
                  <Button variant="subtle" color="red" size="compact-sm" onClick={() => remove(s.id)}>Delete</Button>
                </Group>
              </Table.Td>
            </Table.Tr>
          ))}
          {list.length === 0 && <Table.Tr><Table.Td colSpan={7} c="dimmed">No sales yet.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/Sales.tsx
git commit -m "feat: Sales register on Mantine (Table, Badge pills, Buttons)"
```

---

### Task 8: Stock ledger

**Files:** Modify `src/renderer/screens/Stock.tsx` (replace). Test: none.

- [ ] **Step 1: Replace `src/renderer/screens/Stock.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, Button, Alert, Group, Table } from '@mantine/core'
import type { LedgerRow, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'

export default function Stock() {
  const nav = useNavigate()
  const [rows, setRows] = useState<LedgerRow[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { (async () => {
    try { setSettings(await window.api.getSettings()); setRows(await window.api.stockLedger()) } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [])
  const low = settings?.low_stock_threshold ?? 0
  let lastHsn = ''; let running = 0
  return (
    <div>
      <PageHeader title="Stock" action={<Group gap="sm">
        <Button variant="default" onClick={() => nav('/sales/new')}>New sale from stock</Button>
        <Button onClick={() => nav('/stock/adjust')}>Adjust stock</Button>
      </Group>} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">
        <ListTable head={<><Table.Th>HSN</Table.Th><Table.Th>Lot</Table.Th><Table.Th>Date</Table.Th><Table.Th>Supplier</Table.Th><Table.Th ta="right">In</Table.Th><Table.Th ta="right">Consumed</Table.Th><Table.Th ta="right">Balance</Table.Th><Table.Th ta="right">Running</Table.Th></>}>
          {rows.map(r => {
            if (r.hsn_code !== lastHsn) { lastHsn = r.hsn_code; running = 0 }
            running += r.balance_kg
            const isLow = r.balance_kg < low
            return (
              <Table.Tr key={r.purchase_id} bg={isLow ? 'orange.0' : undefined}>
                <Table.Td>{r.hsn_code}</Table.Td><Table.Td>{r.our_code}</Table.Td><Table.Td>{r.invoice_date}</Table.Td><Table.Td>{r.party}</Table.Td>
                <Table.Td ta="right">{r.qty_kg}</Table.Td><Table.Td ta="right">{r.consumed_kg}</Table.Td><Table.Td ta="right">{r.balance_kg}{isLow ? ' ⚠' : ''}</Table.Td><Table.Td ta="right">{running}</Table.Td>
              </Table.Tr>)
          })}
          {rows.length === 0 && <Table.Tr><Table.Td colSpan={8} c="dimmed">No stock on hand.</Table.Td></Table.Tr>}
        </ListTable>
      </Paper>
    </div>
  )
}
```

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/Stock.tsx
git commit -m "feat: Stock ledger on Mantine (Table, low-stock highlight)"
```

---

### Task 9: CustomerForm

**Files:** Modify `src/renderer/screens/CustomerForm.tsx`. Test: none.

- [ ] **Step 1:** Apply the form-screen mapping (top of Phase C) to `CustomerForm.tsx`. Specifically: replace the local `F(label, node, err)` helper and its raw `<input>`/`<textarea>` usages so each field renders a Mantine control carrying its own `label` + `error`:
  - text fields (name, gstin, pan, phone, city) → `<TextInput label="…" value={…} onChange={e => set({…: e.currentTarget.value})} error={errs.…} />`
  - address fields → `<Textarea label="Address" autosize minRows={2} value onChange error />`
  - `StateSelect`/`PincodeField` stay (already Mantine) but pass them inside a labelled `<Input.Wrapper label="State" error={errs.…}>…</Input.Wrapper>` if they don't take a `label` prop.
  - the "Shipping same as billing" `<label><input type="checkbox">…` → `<Checkbox label="Shipping address is the same as billing" checked={form.shipping_same} onChange={e => set({ shipping_same: e.currentTarget.checked })} />`
  - footer buttons → `<Button variant="default" onClick=cancel>Cancel</Button>` + `<Button disabled={!valid} onClick=save>Save customer</Button>`
  Keep `FormPage`/`FormSection` wrappers, the `errs`/`valid` logic, the `set`, the edit-load `useEffect`, and all `window.api` calls verbatim. On successful save, optionally `notifications.show({ message: 'Customer saved', color: 'green' })` before `nav('/customers')`.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/CustomerForm.tsx
git commit -m "feat: CustomerForm inputs on Mantine (TextInput/Textarea/Checkbox + labelled errors)"
```

---

### Task 10: PurchaseForm

**Files:** Modify `src/renderer/screens/PurchaseForm.tsx`. Test: none.

- [ ] **Step 1:** Apply the form-screen mapping to `PurchaseForm.tsx`: replace the `F()` helper + raw `<input>`/`<select>`/`<textarea>` with Mantine `TextInput`/`Select`/`Textarea` carrying `label` + `error`; HSN `<select>` → `<Select label="HSN" data={hsn.map(h => ({ value: h.hsn_code, label: \`${h.hsn_code} (${h.gst_rate}%)\` }))} value={form.hsn_code || null} onChange={v => set({ hsn_code: v ?? '' })} error={errs.hsn_code} />`; `<input type="date">` → `<DateField value={form.invoice_date} onChange={d => set({ invoice_date: d })} />`; payment status `<select>` → `<Select data={[{value:'pending',label:'Pending'},{value:'done',label:'Done'}]} …/>`; the computed Taxable amount → `<TextInput label="Taxable amount" disabled value={formatINR(amount)} />` (greyed/disabled, not editable); footer buttons → `<Button>`s. Keep `MoneyInput`/`SignedMoneyInput`/`StateSelect`/`TaxSummary`/`FormPage`/`FormSection`, the derived `amount`, `computeTax`, `errs`/`valid`, the auto-code `useEffect`, and all logic verbatim.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/PurchaseForm.tsx
git commit -m "feat: PurchaseForm inputs on Mantine (TextInput/Select/DateField + labelled errors)"
```

---

### Task 11: NewSale

**Files:** Modify `src/renderer/screens/NewSale.tsx`. Test: none.

- [ ] **Step 1:** Apply the form-screen mapping to `NewSale.tsx`. The page chrome: wrap sections in `<Paper withBorder p="lg" radius="md" mb="md">`; `PageHeader` stays; error → `<Alert color="red">`. The header fields: invoice number → `<TextInput>`, date → `<DateField>`, buyer `<select>` → `<Select searchable data={customers.map(c => ({ value: String(c.id), label: c.name + (c.gstin?\` (${c.gstin})\`:'') }))} value={buyerId?String(buyerId):null} onChange={v => setBuyerId(v?Number(v):null)} />`. The "Optional (e-way bill, vehicle)" toggle → a Mantine `<Collapse>` driven by the existing `showOptional` (button → `<Button variant="subtle">`). The lot **allocation table** → `ListTable`/`Table` with a `<Checkbox>` in the include cell and `MoneyInput` in the Sell/kg + Qty cells (these already work). Round-off `SignedMoneyInput` + payment `Select` + `DateField` stay. `TaxSummary` stays. Footer → `<Button variant="default">Cancel</Button>`, `<Button onClick={()=>save(false)}>Save</Button>`, `<Button onClick={()=>save(true)}>Save & preview PDF</Button>`. Keep `computeSaleTax`, the `lines` memo, `setLine`, `save`, and all logic verbatim.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/NewSale.tsx
git commit -m "feat: NewSale on Mantine (lot Table with checkboxes, Select buyer, Collapse optional)"
```

---

### Task 12: Stock adjustment screen

**Files:** Modify `src/renderer/screens/StockAdjust.tsx`. Test: none.

- [ ] **Step 1:** Apply the mapping to `StockAdjust.tsx`: the guidance panel → `<Paper withBorder p="lg" radius="md">` with `<Text>`/`<List>`; the disclaimer → `<Alert color="orange" variant="light">…</Alert>`; the lot `<select>` → `<Select label="Lot" data={lots.map(r => ({ value: String(r.purchase_id), label: \`${r.our_code} (${r.hsn_code}) — ${r.balance_kg} kg left\` }))} value={adj.purchase_id?String(adj.purchase_id):null} onChange={v => setAdj({ ...adj, purchase_id: v?Number(v):null })} />`; quantity `MoneyInput` stays; date `<input type="date">` → `<DateField>`; reason `<select>` → `<Select data={REASONS} …/>`; the "Recent adjustments" `<table>` → `ListTable`; Undo button → `<Button variant="subtle" color="red" size="compact-sm">`; record button → `<Button>`. Keep `createStockAdjustment`/`deleteAdjustment`/`listAdjustments` calls + validation verbatim.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/StockAdjust.tsx
git commit -m "feat: StockAdjust on Mantine (Alert disclaimer, Select lot, Table recents)"
```

---

### Task 13: Settings

**Files:** Modify `src/renderer/screens/Settings.tsx`. Test: none.

- [ ] **Step 1:** Apply the mapping to `Settings.tsx`: the `<div className="panel">` blocks → `<Paper withBorder p="lg" radius="md" mb="md">`; section headings → `<Title order={2}>`; raw `<input>`/`<textarea>` → `<TextInput>`/`<Textarea>` with labels; Home state stays `StateSelect`; Pincode stays `PincodeField` (wrap in `<Input.Wrapper label="Pincode">` if no label prop); the **Data folder** field → `<TextInput label="Data folder" disabled value={s.data_folder} />` (greyed, non-editable); GST-rate/threshold/backup numeric fields → `MoneyInput` (already); the HSN products `<table>` → `ListTable`; "Save settings"/"Backup now"/"Add / update" → `<Button>`s; the saved/backup message → `notifications.show(...)` instead of the inline `<p className="ok">`. Keep all `window.api` calls + state verbatim.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/Settings.tsx
git commit -m "feat: Settings on Mantine (Paper sections, inputs, HSN Table, notifications)"
```

---

### Task 14: Onboarding (FirstRun)

**Files:** Modify `src/renderer/screens/FirstRun.tsx`. Test: none.

- [ ] **Step 1:** Apply the mapping to `FirstRun.tsx`: outer wrapper → `<Container size="sm" py="xl">`; the card → `<Paper withBorder p="xl" radius="md">`; section headings → `<Title order={3}>` + `<Divider>`; the data-folder row → `<Group>` with a **`disabled`** `<TextInput>` showing the chosen folder (greyed, non-editable) + `<Button>Choose…</Button>`; business fields → `<TextInput>` with `label` + inline `error` (replace the `fieldErr(...)` helper by passing `error` to each input); mobile/gstin/pan keep their sanitizing onChange; Home state stays `StateSelect`; Pincode stays `PincodeField`; address → `<Textarea>`; the CTA → `<Button disabled={!valid} onClick={start}>Start using Granule Trader</Button>`; errors → `<Alert color="red">`. Keep `deriveInvoicePrefix`, the `valid` expression, and the `saveSettings` payload verbatim.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/FirstRun.tsx
git commit -m "feat: onboarding on Mantine (Container/Paper, labelled inputs, Alert)"
```

---

### Task 15: InvoiceView chrome (template stays plain)

**Files:** Modify `src/renderer/screens/InvoiceView.tsx`. Test: `tests/renderer/invoice-template.test.tsx` unchanged (template untouched). 

- [ ] **Step 1:** In `InvoiceView.tsx`, replace the `.no-print` toolbar `<div>` + `<button>`s with Mantine: a `<Group className="no-print" p="md">` containing `<Button onClick={() => window.print()}>Print / Save as PDF</Button>` and `<Button variant="default" onClick={() => nav('/sales')}>Back to sales</Button>`. **Do NOT touch `InvoiceTemplate` or `invoice.css`** — the printable block stays plain HTML/CSS for PDF fidelity. Keep the data loading + `window.print()` verbatim.

- [ ] **Step 2: Verify + commit**

Run: `npm run typecheck && npm test && npm run build`
```bash
git add src/renderer/screens/InvoiceView.tsx
git commit -m "feat: InvoiceView toolbar on Mantine (printable template unchanged)"
```

---

## Phase D — Cleanup

### Task 16: Remove the obsolete custom CSS

**Files:** Delete `src/renderer/theme.css`; remove its import.

- [ ] **Step 1:** Confirm nothing still references `theme.css` classes:

Run: `grep -rn "className=\"\(panel\|row\|card\|field\|sidebar\|error-banner\|pill\|tax-summary\|kpi\|form-grid\|page-head\|notice\|grow\|muted\b\)" src/renderer/screens src/renderer/components || echo "no legacy class usages"`
Expected: `no legacy class usages` (if any remain, migrate them in their screen before deleting the CSS).

- [ ] **Step 2:** Remove the `import './theme.css'` line from wherever it is imported (it was in the old `App.tsx`; the Task-1 rewrite already dropped it — confirm with `grep -rn "theme.css" src/`). Delete the file: `git rm src/renderer/theme.css`.

- [ ] **Step 3: Verify + commit**

Run: `npm test && npm run typecheck && npm run build`
Expected: all green; the app is fully on Mantine.
```bash
git add -A
git commit -m "chore: remove obsolete custom theme.css (fully on Mantine)"
```

---

## Notes for the implementer

- **App stays working:** after Task 1 the shell is Mantine and old screens still render (both stylesheets coexist until Phase D). Each screen task is independently shippable.
- **Mantine onChange shapes:** `TextInput`/`Textarea` give `e.currentTarget.value`; `Select` gives `value | null`; `NumberInput` gives `number | string`; `Checkbox` gives `e.currentTarget.checked`. The shared wrappers already coerce; for raw screen inputs follow the mapping table.
- **Don't touch logic:** every screen task preserves hooks, handlers, validation (`errs`/`valid`), and `window.api` calls verbatim — only presentational elements change.
- **Printable invoice** (`InvoiceTemplate` + `invoice.css`) is intentionally left plain for clean PDF output.
- For any unexpected test/build failure that isn't a one-line fix, use the systematic-debugging skill.
