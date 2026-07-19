import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Group, Paper, Table, Text, Title } from '@mantine/core'
import type { Sale, Purchase, Settings } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import DateField from '../components/DateField'
import { dayBook, shiftDate, type DaySection } from '../lib/daybook'
import { formatINR, formatDate, today } from '../lib/format'
import './reports.css'

export default function Daybook() {
  const [date, setDate] = useState(today())
  const [sales, setSales] = useState<Sale[]>([])
  const [purchases, setPurchases] = useState<Purchase[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { (async () => {
    try {
      // A day book reaches across financial years, so load everything, not just the current FY.
      setSales(await window.api.listSales())
      setPurchases(await window.api.listPurchases())
      setSettings(await window.api.getSettings())
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [])

  const db = useMemo(() => dayBook(date, { sales, purchases }), [date, sales, purchases])
  const anything = db.salesInvoiced.lines.length + db.purchasesBooked.lines.length +
    db.paymentsReceived.lines.length + db.paymentsMade.lines.length > 0

  function csvSection(title: string, refHead: string, s: DaySection): string[] {
    if (s.lines.length === 0) return [title, `${refHead},Party,Amount`, 'None', '']
    return [
      title, `${refHead},Party,Amount`,
      ...s.lines.map(l => `${l.ref},${l.party.replace(/,/g, ' ')},${l.amount}`),
      `TOTAL,,${s.total}`, '',
    ]
  }
  async function download() {
    const rows = [
      `Day Book,${date}`, '',
      ...csvSection('SALES INVOICED', 'Invoice', db.salesInvoiced),
      ...csvSection('PURCHASES BOOKED', 'Code', db.purchasesBooked),
      ...csvSection('PAYMENTS RECEIVED', 'Invoice', db.paymentsReceived),
      ...csvSection('PAYMENTS MADE', 'Code', db.paymentsMade),
      `NET IN TODAY,,${db.netIn}`,
    ]
    try { await window.api.exportCsv(`Daybook-${date}.csv`, rows.join('\n')) }
    catch (e: any) { setError(e.message ?? String(e)) }
  }

  function sectionCard(title: string, refHead: string, s: DaySection) {
    return (
      <Paper withBorder p="lg" radius="md" mb="md">
        <Group justify="space-between" mb="xs">
          <Title order={4}>{title} <Text span c="dimmed" size="sm">({s.lines.length})</Text></Title>
          <Text fw={700}>{s.lines.length ? formatINR(s.total) : '—'}</Text>
        </Group>
        {s.lines.length === 0 ? (
          <Text c="dimmed" size="sm">None.</Text>
        ) : (
          <ListTable head={<>
            <Table.Th>{refHead}</Table.Th><Table.Th>Party</Table.Th><Table.Th ta="right">Amount</Table.Th>
          </>}>
            {s.lines.map(l => (
              <Table.Tr key={l.id}>
                <Table.Td>{l.ref}</Table.Td><Table.Td>{l.party}</Table.Td>
                <Table.Td ta="right">{formatINR(l.amount)}</Table.Td>
              </Table.Tr>
            ))}
            <Table.Tr>
              <Table.Td fw={700}>TOTAL</Table.Td><Table.Td />
              <Table.Td ta="right" fw={700}>{formatINR(s.total)}</Table.Td>
            </Table.Tr>
          </ListTable>
        )}
      </Paper>
    )
  }

  return (
    <div className="statement-screen">
      <div className="report-controls">
        <PageHeader title="Day book" action={
          <Group>
            <Button variant="default" disabled={!anything} onClick={download}>⭳ Download CSV</Button>
            <Button variant="default" disabled={!anything} onClick={() => window.print()}>🖨 Print / PDF</Button>
          </Group>
        } />
        {error && <Alert color="red" mb="md">{error}</Alert>}
        <Paper withBorder p="md" radius="md" mb="md">
          <Group align="flex-end">
            <Button variant="default" onClick={() => setDate(d => shiftDate(d, -1))}>‹ Prev day</Button>
            <div style={{ minWidth: 160 }}><DateField value={date} onChange={v => v && setDate(v)} /></div>
            <Button variant="default" onClick={() => setDate(d => shiftDate(d, 1))}>Next day ›</Button>
            <Button variant="subtle" onClick={() => setDate(today())}>Today</Button>
          </Group>
        </Paper>
      </div>

      <Group justify="space-between" align="baseline" mb="md">
        <Title order={3}>{settings?.seller_name ? settings.seller_name + ' · ' : ''}Day Book — {formatDate(date)}</Title>
        <Text fw={700} c={db.netIn >= 0 ? 'teal' : 'red'}>Net in today: {formatINR(db.netIn)}</Text>
      </Group>

      {sectionCard('Sales invoiced', 'Invoice', db.salesInvoiced)}
      {sectionCard('Purchases booked', 'Code', db.purchasesBooked)}
      {sectionCard('Payments received', 'Invoice', db.paymentsReceived)}
      {sectionCard('Payments made', 'Code', db.paymentsMade)}
    </div>
  )
}
