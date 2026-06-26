# Invoice Template Exact-Match (ST_006) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the sales invoice to match the business's existing Indian GST TAX INVOICE format (`ST_006`), driven by editable Settings for unique business details and hardcoded boilerplate text, with Original + Duplicate copies.

**Architecture:** Add 7 new unique-business fields to the key-value Settings (captured & required in both onboarding and Settings). Add a pure `rupeesInWords` helper. Rewrite `InvoiceTemplate.tsx` + `invoice.css` to the bordered reference layout (seller/meta header, Buyer|Consignee, line items consolidated by HSN+rate, HSN-wise tax summary, amount-in-words, bank/declaration, signature), rendered twice (Original/Duplicate). `InvoiceView` passes an HSN→description map.

**Tech Stack:** Electron + React + TypeScript, Mantine 7 + @mantine/form, better-sqlite3 (settings are key-value rows — no migration), Vitest + @testing-library/react.

## Global Constraints

- Unique business details come from Settings; generic boilerplate text is hardcoded. The business **name** in boilerplate is interpolated from `seller_name` (never hardcoded).
- 7 new Settings keys: `seller_godown_address`, `seller_udyam`, `seller_email`, `bank_name`, `bank_branch`, `bank_account_no`, `bank_ifsc` — all string, default `''`, **required** (`isNotEmpty`) in onboarding AND Settings.
- Hardcoded text values (verbatim): Payment Terms = `Immediate`; Delivery Terms = `Ex-Godown - Freight arranged & paid by party`; Declaration = `We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.`
- Line items consolidate allocations by `(hsn_code, rate_per_kg)`; Unit = `Kgs`; description = HSN product description.
- Order No / Delivery Note / Remarks render as blank labelled rows (no schema change).
- Two copies: render Original then Duplicate, identical except the top-right marker.
- Intra-state vs inter-state: `sale.igst > 0` → IGST; else CGST + SGST (existing rule).
- Amounts in the printed body are plain Indian-grouped numbers with 2 decimals (no `₹`), except Rate/Unit which shows `₹` like the reference.
- Run tests with `npm test`; if its `pretest` better-sqlite3 rebuild flakes (node v24/node-gyp), the binary is valid — fall back to `npx vitest run`. The suite has one PRE-EXISTING unrelated unhandled error in `tests/renderer/fy.test.tsx`.
- Do NOT run `npm run rebuild:electron` or `npm run dev` (operator-only).

---

### Task 1: Add the 7 Settings fields (type + defaults)

**Files:**
- Modify: `src/shared/types.ts` (Settings interface)
- Modify: `src/main/core/reference.ts:4-8` (DEFAULT_SETTINGS)
- Test: `tests/core/reference.test.ts`

**Interfaces:**
- Produces: `Settings` gains `seller_godown_address, seller_udyam, seller_email, bank_name, bank_branch, bank_account_no, bank_ifsc: string`; `getSettings` returns `''` for each when unset.

- [ ] **Step 1: Write the failing test**

Add to `tests/core/reference.test.ts` inside `describe('settings', …)`:

```ts
  it('defaults the new invoice fields to empty and persists them', () => {
    const s = getSettings(db)
    for (const k of ['seller_godown_address','seller_udyam','seller_email','bank_name','bank_branch','bank_account_no','bank_ifsc'] as const)
      expect(s[k]).toBe('')
    saveSettings(db, { bank_ifsc: 'ICIC0000317', seller_udyam: 'UDYAM-WB-10-0066963' })
    expect(getSettings(db).bank_ifsc).toBe('ICIC0000317')
    expect(getSettings(db).seller_udyam).toBe('UDYAM-WB-10-0066963')
  })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/core/reference.test.ts`
Expected: FAIL — TypeScript error / `s[k]` undefined (keys not in Settings/DEFAULT_SETTINGS).

- [ ] **Step 3: Add the fields**

In `src/shared/types.ts`, add to the `Settings` interface (after `home_state`):

```ts
  seller_godown_address: string
  seller_udyam: string
  seller_email: string
  bank_name: string
  bank_branch: string
  bank_account_no: string
  bank_ifsc: string
```

In `src/main/core/reference.ts`, extend `DEFAULT_SETTINGS`:

```ts
export const DEFAULT_SETTINGS: Settings = {
  seller_name: '', seller_address: '', seller_gstin: '', seller_pan: '', seller_phone: '',
  seller_city: '', seller_pincode: '', home_state: '',
  seller_godown_address: '', seller_udyam: '', seller_email: '',
  bank_name: '', bank_branch: '', bank_account_no: '', bank_ifsc: '',
  invoice_prefix: 'RP', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/core/reference.test.ts`
Expected: PASS. Also run `npm run typecheck` (clean).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types.ts src/main/core/reference.ts tests/core/reference.test.ts
git commit -m "feat: add godown/UDYAM/email/bank Settings fields"
```

---

### Task 2: Capture the 7 fields in onboarding + Settings (required)

**Files:**
- Modify: `src/renderer/screens/FirstRun.tsx`
- Modify: `src/renderer/screens/Settings.tsx`
- Test: `tests/renderer/firstrun-fields.test.tsx` (create)

**Interfaces:**
- Consumes: `Settings` fields from Task 1.
- Produces: both forms collect & require the 7 fields; `FirstRun.start()` includes them in the `saveSettings` payload.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/firstrun-fields.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithMantine } from './mantine'
import FirstRun from '../../src/renderer/screens/FirstRun'

describe('FirstRun new business fields', () => {
  it('renders the new required invoice fields', () => {
    renderWithMantine(<FirstRun onDone={() => {}} />)
    for (const label of ['Godown address', 'UDYAM No.', 'Email', 'Bank name', 'Bank branch', 'Bank A/C No.', 'IFSC'])
      expect(screen.getByText(label)).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/firstrun-fields.test.tsx`
Expected: FAIL — labels not found.

- [ ] **Step 3: Add fields to FirstRun**

In `src/renderer/screens/FirstRun.tsx`:

a) Extend `initialValues` (add to the object): `seller_godown_address: '', seller_udyam: '', seller_email: '', bank_name: '', bank_branch: '', bank_account_no: '', bank_ifsc: ''`.

b) Add validators (inside `validate`):

```ts
      seller_godown_address: isNotEmpty('Enter the godown address.'),
      seller_udyam: isNotEmpty('Enter the UDYAM number.'),
      seller_email: isNotEmpty('Enter the email.'),
      bank_name: isNotEmpty('Enter the bank name.'),
      bank_branch: isNotEmpty('Enter the bank branch.'),
      bank_account_no: isNotEmpty('Enter the A/C number.'),
      bank_ifsc: isNotEmpty('Enter the IFSC.'),
```

c) Add inputs in the "Your business" `SimpleGrid` (after the existing address field group):

```tsx
          <TextInput label="Godown address" withAsterisk style={{ gridColumn: 'span 2' }} {...form.getInputProps('seller_godown_address')} />
          <TextInput label="UDYAM No." withAsterisk {...form.getInputProps('seller_udyam')} />
          <TextInput label="Email" withAsterisk {...form.getInputProps('seller_email')} />
          <TextInput label="Bank name" withAsterisk {...form.getInputProps('bank_name')} />
          <TextInput label="Bank branch" withAsterisk {...form.getInputProps('bank_branch')} />
          <TextInput label="Bank A/C No." withAsterisk {...form.getInputProps('bank_account_no')} />
          <TextInput label="IFSC" withAsterisk {...form.getInputProps('bank_ifsc')} />
```

d) In `start(v)`, add the new keys to the `saveSettings({...})` payload:

```ts
        seller_godown_address: v.seller_godown_address.trim(), seller_udyam: v.seller_udyam.trim(),
        seller_email: v.seller_email.trim(), bank_name: v.bank_name.trim(), bank_branch: v.bank_branch.trim(),
        bank_account_no: v.bank_account_no.trim(), bank_ifsc: v.bank_ifsc.trim().toUpperCase(),
```

- [ ] **Step 4: Add fields to Settings**

In `src/renderer/screens/Settings.tsx`:

a) Add validators in `useForm({ validate: { … } })`:

```ts
      seller_godown_address: isNotEmpty('Enter the godown address.'),
      seller_udyam: isNotEmpty('Enter the UDYAM number.'),
      seller_email: isNotEmpty('Enter the email.'),
      bank_name: isNotEmpty('Enter the bank name.'),
      bank_branch: isNotEmpty('Enter the bank branch.'),
      bank_account_no: isNotEmpty('Enter the A/C number.'),
      bank_ifsc: isNotEmpty('Enter the IFSC.'),
```

b) Add a block of inputs in the "Business" `Paper`, before the "Save settings" `Group`:

```tsx
        <Textarea label="Godown address" autosize minRows={2} {...form.getInputProps('seller_godown_address')} mb="md" />
        <SimpleGrid cols={3} mb="md">
          <TextInput label="UDYAM No." {...form.getInputProps('seller_udyam')} />
          <TextInput label="Email" {...form.getInputProps('seller_email')} />
          <TextInput label="Bank name" {...form.getInputProps('bank_name')} />
          <TextInput label="Bank branch" {...form.getInputProps('bank_branch')} />
          <TextInput label="Bank A/C No." {...form.getInputProps('bank_account_no')} />
          <TextInput label="IFSC" {...form.getInputProps('bank_ifsc')} />
        </SimpleGrid>
```

- [ ] **Step 5: Run tests + typecheck**

Run: `npm test -- tests/renderer/firstrun-fields.test.tsx` then `npm run typecheck`
Expected: PASS; typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/screens/FirstRun.tsx src/renderer/screens/Settings.tsx tests/renderer/firstrun-fields.test.tsx
git commit -m "feat: collect required bank/UDYAM/godown/email in onboarding & settings"
```

---

### Task 3: `rupeesInWords` helper

**Files:**
- Create: `src/renderer/lib/words.ts`
- Test: `tests/renderer/words.test.ts`

**Interfaces:**
- Produces: `rupeesInWords(amount: number): string`.

- [ ] **Step 1: Write the failing test**

Create `tests/renderer/words.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rupeesInWords } from '../../src/renderer/lib/words'

describe('rupeesInWords', () => {
  it('matches the ST_006 reference strings', () => {
    expect(rupeesInWords(260000)).toBe('Rupees Two lakh sixty thousand only')
    expect(rupeesInWords(39661.20)).toBe('Rupees Thirty-nine thousand six hundred sixty-one and twenty paise only')
  })
  it('handles zero, hundreds, lakh/crore, and paise', () => {
    expect(rupeesInWords(0)).toBe('Rupees Zero only')
    expect(rupeesInWords(661)).toBe('Rupees Six hundred sixty-one only')
    expect(rupeesInWords(10000000)).toBe('Rupees One crore only')
    expect(rupeesInWords(105.5)).toBe('Rupees One hundred five and fifty paise only')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/renderer/words.test.ts`
Expected: FAIL — cannot resolve `../../src/renderer/lib/words`.

- [ ] **Step 3: Implement the helper**

Create `src/renderer/lib/words.ts`:

```ts
const ONES = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen']
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety']

function twoDigits(n: number): string {
  if (n < 20) return ONES[n]
  const t = Math.floor(n / 10), o = n % 10
  return TENS[t] + (o ? '-' + ONES[o] : '')
}

function threeDigits(n: number): string {
  const h = Math.floor(n / 100), rest = n % 100
  const parts: string[] = []
  if (h) parts.push(ONES[h] + ' hundred')
  if (rest) parts.push(twoDigits(rest))
  return parts.join(' ')
}

// Indian grouping: crore (2-digit), lakh (2-digit), thousand (2-digit), hundreds (3-digit).
function intToWords(n: number): string {
  if (n === 0) return 'zero'
  const crore = Math.floor(n / 10000000); let rem = n % 10000000
  const lakh = Math.floor(rem / 100000); rem %= 100000
  const thousand = Math.floor(rem / 1000); rem %= 1000
  const parts: string[] = []
  if (crore) parts.push(twoDigits(crore) + ' crore')
  if (lakh) parts.push(twoDigits(lakh) + ' lakh')
  if (thousand) parts.push(twoDigits(thousand) + ' thousand')
  if (rem) parts.push(threeDigits(rem))
  return parts.join(' ')
}

// "Rupees <words> [and <words> paise] only" with only the first letter capitalised.
export function rupeesInWords(amount: number): string {
  const rupees = Math.floor(amount + 1e-9)
  const paise = Math.round((amount - rupees) * 100)
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  let words = 'Rupees ' + cap(intToWords(rupees))
  if (paise) words += ' and ' + intToWords(paise) + ' paise'
  return words + ' only'
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/renderer/words.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/lib/words.ts tests/renderer/words.test.ts
git commit -m "feat: rupeesInWords (Indian numbering, paise) for invoices"
```

---

### Task 4: Rebuild `InvoiceTemplate` to the ST_006 layout

**Files:**
- Modify (rewrite): `src/renderer/invoice/InvoiceTemplate.tsx`
- Modify (rewrite): `src/renderer/invoice/invoice.css`
- Modify: `src/renderer/screens/InvoiceView.tsx` (fetch HSN descriptions, pass prop)
- Test (rewrite): `tests/renderer/invoice-template.test.tsx`

**Interfaces:**
- Consumes: `Settings` (Task 1 fields), `rupeesInWords` (Task 3), `panFromGstin` from `@shared/validation`.
- Produces: `InvoiceTemplate(props: { sale: Sale; allocations: SaleAllocation[]; settings: Settings; hsnDescriptions: Record<string, string> })` rendering Original + Duplicate copies.

- [ ] **Step 1: Rewrite the test (new contract)**

Replace `tests/renderer/invoice-template.test.tsx` with:

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import InvoiceTemplate from '../../src/renderer/invoice/InvoiceTemplate'
import type { Sale, SaleAllocation, Settings } from '@shared/types'

const settings = { seller_name: 'Shivam Traders', seller_address: 'Off Addr', seller_godown_address: 'Godown Addr',
  seller_gstin: '19ACNPC1217E1Z0', seller_pan: 'ACNPC1217E', seller_phone: '', seller_city: 'Kolkata', seller_pincode: '700001',
  home_state: 'West Bengal', seller_udyam: 'UDYAM-WB-10-0066963', seller_email: 'a@b.com',
  bank_name: 'ICICI BANK LIMITED', bank_branch: 'NEW ALIPORE', bank_account_no: '031705500675', bank_ifsc: 'ICIC0000317',
  invoice_prefix: 'ST', default_gst_rate: 18, data_folder: '', low_stock_threshold: 500, backups_to_keep: 10 } as Settings
const sale = { id: 1, invoice_number: 'ST/006/2025-26', invoice_date: '2025-04-14', buyer_name: 'SAMTA IMPEX',
  buyer_gstin: '19AAECM3696H1Z1', buyer_billing_json: '{"city":"Howrah","state":"West Bengal","pincode":"711405"}',
  buyer_shipping_json: '{}', amount: 220340, cgst: 19830.6, sgst: 19830.6, igst: 0, tcs: 0, roundoff: -1.2,
  total_invoice_amount: 260000, total_qty_kg: 2000, vehicle: 'WB23E9212', eway_bill_no: '821520090058', eway_bill_date: '2025-04-14' } as unknown as Sale
const allocs = [{ id: 1, sale_id: 1, purchase_id: 1, hsn_code: '39023000', gst_rate: 18, qty_drawn_kg: 2000, rate_per_kg: 110.17, line_amount: 220340 }] as SaleAllocation[]
const hsnDescriptions = { '39023000': 'Plastic Granules' }

describe('InvoiceTemplate', () => {
  it('renders seller, buyer, invoice number, total and amount-in-words', () => {
    render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(screen.getAllByText('Shivam Traders').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/ST\/006\/2025-26/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/SAMTA IMPEX/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Plastic Granules').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/2,60,000\.00/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Rupees Two lakh sixty thousand only').length).toBeGreaterThan(0)
  })
  it('shows the bank block and both copies', () => {
    render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(screen.getAllByText(/ICIC0000317/).length).toBeGreaterThan(0)
    expect(screen.getByText('Original')).toBeTruthy()
    expect(screen.getByText('Duplicate')).toBeTruthy()
  })
  it('uses CGST/SGST intra-state and IGST inter-state', () => {
    const { container, rerender } = render(<InvoiceTemplate sale={sale} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('CGST')
    const inter = { ...sale, cgst: 0, sgst: 0, igst: 39661.2 } as unknown as Sale
    rerender(<InvoiceTemplate sale={inter} allocations={allocs} settings={settings} hsnDescriptions={hsnDescriptions} />)
    expect(container.textContent).toContain('IGST')
    expect(container.textContent).not.toContain('CGST')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- tests/renderer/invoice-template.test.tsx`
Expected: FAIL — `hsnDescriptions` prop unused / "Original"/"Duplicate"/amount-in-words not rendered by the old template.

- [ ] **Step 3: Rewrite `InvoiceTemplate.tsx`**

Replace `src/renderer/invoice/InvoiceTemplate.tsx` with:

```tsx
import type { Sale, SaleAllocation, Settings } from '@shared/types'
import { panFromGstin } from '@shared/validation'
import { rupeesInWords } from '../lib/words'
import './invoice.css'

const PAYMENT_TERMS = 'Immediate'
const DELIVERY_TERMS = 'Ex-Godown - Freight arranged & paid by party'
const DECLARATION = 'We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct.'

type Addr = { address?: string; city?: string; state?: string; pincode?: string }
function parseAddr(json: string): Addr { try { return (JSON.parse(json) || {}) as Addr } catch { return {} } }
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const num = (n: number) => n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const addrLine = (a: Addr) => [a.address, a.city, a.pincode].filter(Boolean).join(', ')

export interface InvoiceTemplateProps {
  sale: Sale; allocations: SaleAllocation[]; settings: Settings; hsnDescriptions: Record<string, string>
}

export default function InvoiceTemplate({ sale, allocations, settings, hsnDescriptions }: InvoiceTemplateProps) {
  const interState = sale.igst > 0

  const lineMap = new Map<string, { hsn: string; rate: number; qty: number; amount: number }>()
  for (const a of allocations) {
    const k = `${a.hsn_code}@${a.rate_per_kg}`
    const g = lineMap.get(k) ?? { hsn: a.hsn_code, rate: a.rate_per_kg, qty: 0, amount: 0 }
    g.qty = r2(g.qty + a.qty_drawn_kg); g.amount = r2(g.amount + a.line_amount); lineMap.set(k, g)
  }
  const lines = [...lineMap.values()]

  const taxMap = new Map<string, { hsn: string; rate: number; taxable: number }>()
  for (const a of allocations) {
    const k = `${a.hsn_code}@${a.gst_rate}`
    const g = taxMap.get(k) ?? { hsn: a.hsn_code, rate: a.gst_rate, taxable: 0 }
    g.taxable = r2(g.taxable + a.line_amount); taxMap.set(k, g)
  }
  const taxGroups = [...taxMap.values()]
  const totalTax = r2(sale.cgst + sale.sgst + sale.igst)
  const billing = parseAddr(sale.buyer_billing_json)
  const shipping = parseAddr(sale.buyer_shipping_json)
  const ship = (shipping.address || shipping.city || shipping.state || shipping.pincode) ? shipping : billing
  const buyerPan = panFromGstin(sale.buyer_gstin)

  const copy = (marker: string) => (
    <div className="invoice" key={marker}>
      <div className="inv-marker">{marker}</div>
      <div className="inv-title">TAX INVOICE</div>

      <table className="inv"><tbody>
        <tr>
          <td className="seller">
            <div className="bold big">{settings.seller_name}</div>
            <div><b>Off:</b> {settings.seller_address}</div>
            <div><b>Godown:</b> {settings.seller_godown_address}</div>
            <div>{settings.home_state}</div>
            <div><b>GSTIN/UIN:</b> {settings.seller_gstin}</div>
            <div><b>PAN/IT No.:</b> {settings.seller_pan}</div>
            <div><b>UDYAM No.:</b> {settings.seller_udyam}</div>
            <div><b>Email:</b> {settings.seller_email}</div>
          </td>
          <td className="meta">
            <table className="kv"><tbody>
              <tr><td>Invoice No</td><td className="bold">{sale.invoice_number}</td><td>Date</td><td>{sale.invoice_date}</td></tr>
              <tr><td>e-Way Bill No</td><td>{sale.eway_bill_no ?? ''}</td><td>Date</td><td>{sale.eway_bill_date ?? ''}</td></tr>
              <tr><td>Delivery Note</td><td></td><td>Date</td><td></td></tr>
              <tr><td>Order No</td><td></td><td>Date</td><td></td></tr>
              <tr><td>Payment Terms</td><td colSpan={3}>{PAYMENT_TERMS}</td></tr>
              <tr><td>Vehicle No</td><td colSpan={3}>{sale.vehicle ?? ''}</td></tr>
              <tr><td>Delivery Terms</td><td colSpan={3}>{DELIVERY_TERMS}</td></tr>
              <tr><td>Remarks</td><td colSpan={3}></td></tr>
            </tbody></table>
          </td>
        </tr>
      </tbody></table>

      <table className="inv"><tbody>
        <tr><td className="bold half">Buyer (if other than consignee)</td><td className="bold half">Consignee</td></tr>
        <tr>
          <td className="party">
            <div className="bold">{sale.buyer_name}</div>
            <div>{addrLine(billing)}</div>
            <div><b>GSTIN/UIN:</b> {sale.buyer_gstin}</div>
            <div><b>PAN/IT No.:</b> {buyerPan}</div>
            <div><b>State Name:</b> {billing.state ?? ''}</div>
            <div><b>Place of Supply:</b> {billing.state ?? ''}</div>
          </td>
          <td className="party">
            <div className="bold">{sale.buyer_name}</div>
            <div>{addrLine(ship)}</div>
            <div><b>GSTIN/UIN:</b> {sale.buyer_gstin}</div>
            <div><b>PAN/IT No.:</b> {buyerPan}</div>
            <div><b>State Name:</b> {ship.state ?? ''}</div>
            <div><b>Place of Supply:</b> {ship.state ?? ''}</div>
          </td>
        </tr>
      </tbody></table>

      <table className="inv items">
        <thead><tr>
          <th>Sl No.</th><th>DESCRIPTION OF GOODS</th><th>HSN/SAC</th><th>Qty</th><th>Unit</th><th>Rate/Unit</th><th>AMOUNT Rs.</th>
        </tr></thead>
        <tbody>
          {lines.map((l, i) => (
            <tr key={i} className={i === 0 ? 'firstline' : undefined}>
              <td>{i + 1}</td><td>{hsnDescriptions[l.hsn] ?? ''}</td><td>{l.hsn}</td>
              <td className="right">{l.qty}</td><td>Kgs</td><td className="right">₹ {num(l.rate)}</td><td className="right">{num(l.amount)}</td>
            </tr>
          ))}
          {interState
            ? <tr><td colSpan={6} className="right">IGST</td><td className="right">{num(sale.igst)}</td></tr>
            : <>
                <tr><td colSpan={6} className="right">CGST</td><td className="right">{num(sale.cgst)}</td></tr>
                <tr><td colSpan={6} className="right">SGST</td><td className="right">{num(sale.sgst)}</td></tr>
              </>}
          {sale.roundoff ? <tr><td colSpan={6} className="right">R/Off</td><td className="right">{num(sale.roundoff)}</td></tr> : null}
          <tr className="bold"><td colSpan={3} className="right">TOTAL</td><td className="right">{sale.total_qty_kg}</td><td>Kgs</td><td></td><td className="right">{num(sale.total_invoice_amount)}</td></tr>
        </tbody>
      </table>

      <table className="inv"><tbody>
        <tr><td className="bold">Amount Chargeable (in words)</td><td className="right">E.&amp; O.E</td></tr>
        <tr><td colSpan={2}>{rupeesInWords(sale.total_invoice_amount)}</td></tr>
      </tbody></table>

      <table className="inv tax">
        <thead>
          <tr>
            <th rowSpan={2}>HSN/SAC</th><th rowSpan={2}>Taxable Value</th>
            {interState ? <th colSpan={2}>Integrated Tax</th> : <><th colSpan={2}>Central Tax</th><th colSpan={2}>State Tax</th></>}
            <th rowSpan={2}>Total Tax Amount</th>
          </tr>
          <tr>{interState ? <><th>Rate</th><th>Amount</th></> : <><th>Rate</th><th>Amount</th><th>Rate</th><th>Amount</th></>}</tr>
        </thead>
        <tbody>
          {taxGroups.map((g, i) => {
            const tax = r2(g.taxable * g.rate / 100), half = r2(g.taxable * g.rate / 200)
            return (
              <tr key={i}>
                <td>{g.hsn}</td><td className="right">{num(g.taxable)}</td>
                {interState
                  ? <><td className="right">{g.rate}%</td><td className="right">{num(tax)}</td></>
                  : <><td className="right">{g.rate / 2}%</td><td className="right">{num(half)}</td><td className="right">{g.rate / 2}%</td><td className="right">{num(half)}</td></>}
                <td className="right">{num(tax)}</td>
              </tr>
            )
          })}
          <tr className="bold">
            <td>Total</td><td className="right">{num(sale.amount)}</td>
            {interState
              ? <><td></td><td className="right">{num(sale.igst)}</td></>
              : <><td></td><td className="right">{num(sale.cgst)}</td><td></td><td className="right">{num(sale.sgst)}</td></>}
            <td className="right">{num(totalTax)}</td>
          </tr>
        </tbody>
      </table>

      <table className="inv"><tbody>
        <tr><td className="bold">Tax Amount (in words)</td><td>{rupeesInWords(totalTax)}</td></tr>
      </tbody></table>

      <table className="inv"><tbody>
        <tr>
          <td className="decl half"><div className="bold">DECLARATION:</div><div>{DECLARATION}</div></td>
          <td className="bank half">
            <div>Cheque/ RTGS in name of "{settings.seller_name}"</div>
            <div><b>Bank Name:</b> {settings.bank_name}</div>
            <div><b>Branch:</b> {settings.bank_branch}</div>
            <div><b>A/C No.:</b> {settings.bank_account_no}</div>
            <div><b>IFS Code:</b> {settings.bank_ifsc}</div>
          </td>
        </tr>
        <tr><td className="sign">Customer's Seal &amp; Signature</td><td className="sign right">for {settings.seller_name}</td></tr>
      </tbody></table>
    </div>
  )

  return <>{copy('Original')}{copy('Duplicate')}</>
}
```

- [ ] **Step 4: Rewrite `invoice.css`**

Replace `src/renderer/invoice/invoice.css` with:

```css
.invoice { background: #fff; color: #000; width: 820px; margin: 0 auto 24px; padding: 8px;
  font-size: 11px; font-family: Arial, Helvetica, sans-serif; }
.invoice .inv-marker { text-align: right; font-weight: 700; }
.invoice .inv-title { text-align: center; font-weight: 700; font-size: 14px; border: 1px solid #000; border-bottom: none; padding: 4px; }
.invoice table.inv { width: 100%; border-collapse: collapse; }
.invoice table.inv > tbody > tr > td, .invoice table.inv > thead > tr > th { border: 1px solid #000; padding: 3px 6px; vertical-align: top; }
.invoice table.kv { width: 100%; border-collapse: collapse; }
.invoice table.kv td { border: 1px solid #000; padding: 2px 5px; }
.invoice td.meta { padding: 0; width: 55%; }
.invoice td.seller { width: 45%; }
.invoice td.half { width: 50%; }
.invoice .bold { font-weight: 700; }
.invoice .big { font-size: 13px; }
.invoice .right { text-align: right; }
.invoice table.items th { background: #f0f0f0; }
.invoice table.items tr.firstline td { height: 130px; vertical-align: top; }
@media print {
  .no-print { display: none; }
  body { background: #fff; }
  .invoice { width: auto; margin: 0; page-break-after: always; }
}
```

- [ ] **Step 5: Wire `InvoiceView` to pass HSN descriptions**

In `src/renderer/screens/InvoiceView.tsx`:

a) Add state + import (the component already imports useState):

```tsx
  const [hsnDescriptions, setHsnDescriptions] = useState<Record<string, string>>({})
```

b) In the effect, after fetching settings, fetch HSN and build the map:

```tsx
    const hsn = await window.api.listHsn()
    setHsnDescriptions(Object.fromEntries(hsn.map(h => [h.hsn_code, h.description])))
```

c) Pass the prop:

```tsx
      <InvoiceTemplate sale={data.sale} allocations={data.allocations} settings={settings} hsnDescriptions={hsnDescriptions} />
```

- [ ] **Step 6: Run tests, typecheck, build**

Run: `npm test -- tests/renderer/invoice-template.test.tsx` then `npm run typecheck && npm test && npm run build`
Expected: invoice test PASS; typecheck clean; full suite green (besides the known `fy.test.tsx` unhandled error); build succeeds.

- [ ] **Step 7: Operator pass (human)**

Run: `npm run rebuild:electron && npm run dev`, open a sale → Preview/PDF, Print/Save as PDF. Compare to `ST_006`: both Original + Duplicate present; seller/bank/UDYAM/email correct; buyer + consignee; one consolidated "Plastic Granules" line; CGST/SGST/R-Off/TOTAL; HSN tax summary; both amount-in-words lines. Refine `invoice.css` spacing/column widths as needed (CSS-only tweaks).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/invoice/InvoiceTemplate.tsx src/renderer/invoice/invoice.css src/renderer/screens/InvoiceView.tsx tests/renderer/invoice-template.test.tsx
git commit -m "feat: rebuild invoice to ST_006 GST tax-invoice layout (Original+Duplicate)"
```

---

## Self-Review

**Spec coverage:**
- 7 new Settings fields (type + defaults) → Task 1. ✓
- Captured + required in onboarding AND Settings → Task 2. ✓
- Boilerplate hardcoded with name interpolated → Task 4 (`PAYMENT_TERMS`/`DELIVERY_TERMS`/`DECLARATION`, `for {seller_name}`). ✓
- Amount-in-words helper + tests → Task 3. ✓
- Template layout (seller/meta, Buyer|Consignee, items consolidated by HSN+rate, CGST/SGST vs IGST, HSN tax summary, declaration/bank, signature) → Task 4. ✓
- HSN description via InvoiceView map → Task 4 Step 5. ✓
- Original + Duplicate → Task 4 (`copy('Original')` + `copy('Duplicate')`, CSS `page-break-after`). ✓
- Blank Order No/Delivery Note/Remarks rows → Task 4 meta table. ✓
- Testing (words, template intra/inter-state, reference strings) → Tasks 1,3,4. ✓

**Placeholder scan:** none — every step has full code/commands.

**Type consistency:** `InvoiceTemplateProps` (sale, allocations, settings, hsnDescriptions) is defined in Task 4 and consumed by InvoiceView (Task 4 Step 5) and the test (Step 1); `rupeesInWords(amount: number): string` defined in Task 3 and called in Task 4; the 7 Settings keys are identical across Tasks 1, 2, 4.

**Out of scope (unchanged):** logo/image signature; per-sale Order No/Delivery Note/Remarks; tax computation / FIFO / numbering; Customer-Supplier CSV import and Windows packaging (separate specs).
