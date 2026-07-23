import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, Group, Paper, SegmentedControl, Select, Table, Text, Title } from '@mantine/core'
import type { Sale, Purchase, Customer, Supplier, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { toCsv, salesColumns, purchaseColumns, type CsvColumn } from '../lib/csv'
import {
  fyMonths, filterSalesReport, filterPurchasesReport, reportTotals,
  saleTotalRow, purchaseTotalRow, reportFilename, type TotalRow
} from '../lib/report'
import { formatINR, formatDate, today } from '../lib/format'
import { useFY } from '../fy'
import './reports.css'

type Kind = 'sales' | 'purchases'

// A TOTAL CSV row keyed by column header, so it lines up whatever the column order is.
function totalCsvRow<T>(columns: CsvColumn<T>[], t: TotalRow): (string | number)[] {
  return columns.map((c, i) => {
    if (i === 0) return 'TOTAL'
    switch (c.header) {
      case 'Qty (kg)': return t.qty
      case 'Taxable': return t.taxable
      case 'CGST': return t.cgst
      case 'SGST': return t.sgst
      case 'IGST': return t.igst
      case 'Total': return t.total
      default: return ''
    }
  })
}

export default function Reports() {
  const [params] = useSearchParams()
  const { fy, setFy, years } = useFY()
  const [kind, setKind] = useState<Kind>((params.get('type') as Kind) ?? 'sales')
  const [partyId, setPartyId] = useState<number | null>(params.get('party') ? Number(params.get('party')) : null)
  const [month, setMonth] = useState<string | null>(null)
  const [paid, setPaid] = useState<'all' | 'unpaid'>(params.get('unpaid') === '1' ? 'unpaid' : 'all')
  const [fyMode, setFyMode] = useState<'current' | 'all'>(params.get('unpaid') === '1' ? 'all' : 'current')  // all-years for cross-year debt from Outstanding
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      setSales(await window.api.listSales(fyMode === 'all' ? undefined : fy))
      setPurchases(await window.api.listPurchases(fyMode === 'all' ? undefined : fy))
      setCustomers(await window.api.listCustomers())
      setSuppliers(await window.api.listSuppliers())
      setSettings(await window.api.getSettings())
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [fy, fyMode])

  useEffect(() => { setMonth(null) }, [fy])   // reset month when FY changes

  const parties = kind === 'sales' ? customers : suppliers
  const party = parties.find(p => p.id === partyId) ?? null
  const months = useMemo(() => fyMonths(fy), [fy])
  const monthLabel = month ? months.find(m => m.value === month)?.label : undefined
  const period = (monthLabel ?? fy) + (paid === 'unpaid' ? ' · unpaid only' : '')

  const saleRows = useMemo(() => {
    if (!party || kind !== 'sales') return []
    const r = filterSalesReport(sales, party.id, month ?? undefined)
    return paid === 'unpaid' ? r.filter(s => s.payment_status === 'pending') : r
  }, [party, kind, sales, month, paid])
  const purchaseRows = useMemo(() => {
    if (!party || kind !== 'purchases') return []
    const r = filterPurchasesReport(purchases, party.id, month ?? undefined)
    return paid === 'unpaid' ? r.filter(p => p.payment_status === 'pending') : r
  }, [party, kind, purchases, month, paid])

  const totals: TotalRow = reportTotals(kind === 'sales' ? saleRows.map(saleTotalRow) : purchaseRows.map(purchaseTotalRow))
  const count = kind === 'sales' ? saleRows.length : purchaseRows.length

  async function download() {
    if (!party) return
    const [rows, columns] = kind === 'sales'
      ? [saleRows, salesColumns as CsvColumn<any>[]]
      : [purchaseRows, purchaseColumns as CsvColumn<any>[]]
    let content = toCsv(rows, columns)
    content += '\n' + totalCsvRow(columns, totals).join(',')
    try {
      await window.api.exportCsv(reportFilename(kind === 'sales' ? 'Sales' : 'Purchases', party.name, fy, monthLabel), content)
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  // Money columns read nicer as ₹ on screen; the CSV keeps raw numbers (columns are untouched).
  const MONEY = new Set(['Taxable', 'CGST', 'SGST', 'IGST', 'TCS', 'Round-off', 'Total'])
  function cellText<T>(c: CsvColumn<T>, r: T): string {
    const v = c.value(r)
    if (MONEY.has(c.header) && typeof v === 'number') return formatINR(v)
    if (c.header === 'Qty (kg)') return `${v} kg`
    return String(v)
  }

  function renderTable<T>(rows: T[], columns: CsvColumn<T>[], rowKey: (r: T) => string | number) {
    return (
      <ListTable head={<>{columns.map(c => <Table.Th key={c.header} style={{ whiteSpace: 'nowrap' }}>{c.header}</Table.Th>)}</>}>
        {rows.map(r => (
          <Table.Tr key={rowKey(r)}>
            {columns.map(c => <Table.Td key={c.header} style={{ whiteSpace: 'nowrap' }}>{cellText(c, r)}</Table.Td>)}
          </Table.Tr>
        ))}
        {rows.length === 0 && <Table.Tr><Table.Td colSpan={columns.length} c="dimmed">
          {party ? `No ${kind}${paid === 'unpaid' ? ' outstanding' : ''} for ${party.name} in ${monthLabel ?? fy}.` : 'Choose a party to see their report.'}
        </Table.Td></Table.Tr>}
      </ListTable>
    )
  }

  return (
    <div className="statement-screen">
      <div className="report-controls">
        <PageHeader title="Reports" action={
          <Group>
            <Button variant="default" disabled={count === 0} onClick={download}>⭳ Download CSV</Button>
            <Button variant="default" disabled={count === 0} onClick={() => window.print()}>🖨 Print / PDF</Button>
          </Group>
        } />
        {error && <Alert color="red" mb="md">{error}</Alert>}
        <Paper withBorder p="lg" radius="md" mb="md">
          <Group align="flex-end" mb="sm">
            <SegmentedControl
              value={kind}
              onChange={v => { setKind(v as Kind); setPartyId(null) }}
              data={[{ label: 'Sales by customer', value: 'sales' }, { label: 'Purchases by supplier', value: 'purchases' }]}
            />
            <Select
              label={kind === 'sales' ? 'Customer' : 'Supplier'}
              searchable style={{ minWidth: 280 }}
              placeholder={`Choose a ${kind === 'sales' ? 'customer' : 'supplier'}`}
              data={parties.map(p => ({ value: String(p.id), label: p.name }))}
              value={partyId ? String(partyId) : null}
              onChange={v => setPartyId(v ? Number(v) : null)}
            />
          </Group>
          <Group align="flex-end">
            <Select label="Year" data={fyMode === 'all' ? [{ value: '__all', label: 'All years' }, ...years.map(y => ({ value: y, label: y }))] : years}
              value={fyMode === 'all' ? '__all' : fy}
              onChange={v => {
                if (v === '__all') setFyMode('all')
                else { setFyMode('current'); v && setFy(v) }
              }}
              maw={140} />
            <Select label="Month" maw={160} clearable placeholder="All months" data={months} value={month} onChange={setMonth} />
            <SegmentedControl
              value={paid}
              onChange={v => setPaid(v as 'all' | 'unpaid')}
              data={[{ label: 'All', value: 'all' }, { label: 'Unpaid only', value: 'unpaid' }]}
            />
          </Group>
        </Paper>
      </div>

      <Paper withBorder p="lg" radius="md">
        {party && settings && (
          <div>
            <Title order={3}>{kind === 'sales' ? 'Sales' : 'Purchase'} Statement — {party.name} — {period}</Title>
            <Text c="dimmed" size="sm" mb="md">{settings.seller_name} · generated {formatDate(today())} · {count} invoice{count === 1 ? '' : 's'}</Text>
          </div>
        )}
        {kind === 'sales'
          ? renderTable(saleRows, salesColumns, s => s.id)
          : renderTable(purchaseRows, purchaseColumns, p => p.id)}
        {count > 0 && (
          <Group justify="flex-end" mt="md" gap="xl" data-testid="report-totals">
            <Text fw={700}>{totals.qty} kg</Text>
            <Text fw={700}>Taxable {formatINR(totals.taxable)}</Text>
            <Text c="dimmed">CGST {formatINR(totals.cgst)} · SGST {formatINR(totals.sgst)} · IGST {formatINR(totals.igst)}</Text>
            <Text fw={700}>{formatINR(totals.total)}</Text>
          </Group>
        )}
      </Paper>
    </div>
  )
}
