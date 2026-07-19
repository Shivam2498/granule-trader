import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Alert, Button, Group, Paper, Table, Text, Title, Badge } from '@mantine/core'
import type { Sale, Purchase, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { toCsv, type CsvColumn } from '../lib/csv'
import { receivablesByParty, payablesByParty, type OutstandingReport, type PartyDue } from '../lib/outstanding'
import { formatINR, today } from '../lib/format'
import './reports.css'

const columns: CsvColumn<PartyDue>[] = [
  { header: 'Party', value: r => r.name },
  { header: 'Unpaid invoices', value: r => r.count },
  { header: '0-30 days', value: r => r.b0_30 },
  { header: '31-60 days', value: r => r.b31_60 },
  { header: '60+ days', value: r => r.b60plus },
  { header: 'Total', value: r => r.total },
]

function csvFor(report: OutstandingReport): string {
  let content = toCsv(report.rows, columns)
  content += '\n' + ['TOTAL', report.rows.reduce((a, r) => a + r.count, 0),
    '', '', '', report.total].join(',')
  return content
}

// The oldest-invoice age drives a small colour cue so overdue money stands out at a glance.
function ageBadge(days: number) {
  if (days > 60) return <Badge color="red" variant="light">{days}d</Badge>
  if (days > 30) return <Badge color="orange" variant="light">{days}d</Badge>
  return <Badge color="gray" variant="light">{days}d</Badge>
}

export default function Outstanding() {
  const nav = useNavigate()
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      // Outstanding is a to-date balance across every year — money owed does not reset in April.
      setSales(await window.api.listSales())
      setPurchases(await window.api.listPurchases())
      setSettings(await window.api.getSettings())
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [])

  const now = today()
  const rec = useMemo(() => receivablesByParty(sales, now), [sales, now])
  const pay = useMemo(() => payablesByParty(purchases, now), [purchases, now])

  async function download(kind: 'Receivables' | 'Payables', report: OutstandingReport) {
    try { await window.api.exportCsv(`${kind}-outstanding-${now}.csv`, csvFor(report)) }
    catch (e: any) { setError(e.message ?? String(e)) }
  }

  function section(
    title: string, help: string, kind: 'sales' | 'purchases',
    fileKind: 'Receivables' | 'Payables', report: OutstandingReport
  ) {
    return (
      <Paper withBorder p="lg" radius="md" mb="lg">
        <Group justify="space-between" align="flex-end" mb="xs">
          <div>
            <Title order={3}>{title}</Title>
            <Text c="dimmed" size="sm">{help}</Text>
          </div>
          <Group className="report-controls">
            <Text fw={700} size="lg">{formatINR(report.total)}</Text>
            <Button variant="default" size="xs" disabled={report.rows.length === 0}
              onClick={() => download(fileKind, report)}>⭳ CSV</Button>
          </Group>
        </Group>
        <ListTable head={<>
          <Table.Th>Party</Table.Th>
          <Table.Th ta="right">Unpaid</Table.Th>
          <Table.Th ta="right">0–30d</Table.Th>
          <Table.Th ta="right">31–60d</Table.Th>
          <Table.Th ta="right">60+ d</Table.Th>
          <Table.Th ta="right">Total</Table.Th>
          <Table.Th>Oldest</Table.Th>
        </>}>
          {report.rows.map(r => (
            <Table.Tr key={r.id} style={{ cursor: 'pointer' }}
              onClick={() => nav(`/reports?type=${kind}&party=${r.id}&unpaid=1`)}>
              <Table.Td>{r.name}</Table.Td>
              <Table.Td ta="right">{r.count}</Table.Td>
              <Table.Td ta="right">{r.b0_30 ? formatINR(r.b0_30) : '—'}</Table.Td>
              <Table.Td ta="right">{r.b31_60 ? formatINR(r.b31_60) : '—'}</Table.Td>
              <Table.Td ta="right" c={r.b60plus ? 'red' : undefined}>{r.b60plus ? formatINR(r.b60plus) : '—'}</Table.Td>
              <Table.Td ta="right" fw={600}>{formatINR(r.total)}</Table.Td>
              <Table.Td>{ageBadge(r.oldestDays)}</Table.Td>
            </Table.Tr>
          ))}
          {report.rows.length === 0 && (
            <Table.Tr><Table.Td colSpan={7} c="dimmed">Nothing outstanding. All settled.</Table.Td></Table.Tr>
          )}
          {report.rows.length > 0 && (
            <Table.Tr>
              <Table.Td fw={700}>TOTAL</Table.Td>
              <Table.Td ta="right" fw={700}>{report.rows.reduce((a, r) => a + r.count, 0)}</Table.Td>
              <Table.Td /><Table.Td /><Table.Td />
              <Table.Td ta="right" fw={700}>{formatINR(report.total)}</Table.Td>
              <Table.Td />
            </Table.Tr>
          )}
        </ListTable>
      </Paper>
    )
  }

  return (
    <div className="statement-screen">
      <div className="report-controls">
        <PageHeader title="Outstanding" action={
          <Button variant="default" onClick={() => window.print()}>🖨 Print / PDF</Button>
        } />
        {error && <Alert color="red" mb="md">{error}</Alert>}
      </div>
      <Text c="dimmed" mb="md">{settings?.seller_name ? settings.seller_name + ' · ' : ''}as of {now} · click a row for that party's unpaid invoices</Text>
      {section('Receivables — customers owe you', 'Unpaid sales invoices, aged by invoice date.', 'sales', 'Receivables', rec)}
      {section('Payables — you owe suppliers', 'Unpaid purchase bills, aged by invoice date.', 'purchases', 'Payables', pay)}
    </div>
  )
}
