import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { SimpleGrid, Paper, Group, Text, Badge, UnstyledButton, Stack } from '@mantine/core'
import type { Sale, Purchase, LedgerRow } from '@shared/types'
import { formatINR } from '../../lib/format'

interface ActionCenterProps {
  dueP: Purchase[]
  overdue: Array<{ sale: Sale; daysOld: number }>
  reserved: Sale[]
  lowLots: LedgerRow[]
}

function Card({ title, count, accent, children }: { title: string; count: number; accent: string; children: ReactNode }) {
  return (
    <Paper withBorder p="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Text fw={600}>{title}</Text>
        <Badge color={accent}>{count}</Badge>
      </Group>
      <Stack gap={4}>{children}</Stack>
    </Paper>
  )
}

function Row({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <UnstyledButton onClick={onClick} style={{ display: 'block', width: '100%' }}>
      <Text size="sm" style={{ cursor: 'pointer' }}>{children}</Text>
    </UnstyledButton>
  )
}

const empty = <Text size="sm" c="dimmed">Nothing here.</Text>

export default function ActionCenter({ dueP, overdue, reserved, lowLots }: ActionCenterProps) {
  const nav = useNavigate()
  return (
    <SimpleGrid cols={{ base: 1, sm: 2 }} mb="lg">
      <Card title="Payables due (>2 days)" count={dueP.length} accent="red">
        {dueP.length === 0 ? empty : dueP.map(p =>
          <Row key={p.id} onClick={() => nav(`/purchases/edit/${p.id}`)}>{p.our_code} · {p.party} · {formatINR(p.total_invoice_amount)}</Row>)}
      </Card>
      <Card title="Overdue receivables" count={overdue.length} accent="orange">
        {overdue.length === 0 ? empty : overdue.map(o =>
          <Row key={o.sale.id} onClick={() => nav(`/invoice/${o.sale.id}`)}>{o.sale.invoice_number} · {o.sale.buyer_name} · {formatINR(o.sale.total_invoice_amount)} · {o.daysOld}d</Row>)}
      </Card>
      <Card title="Reserved invoices" count={reserved.length} accent="yellow">
        {reserved.length === 0 ? empty : reserved.map(s =>
          <Row key={s.id} onClick={() => nav(`/sales/fill/${s.id}`)}>{s.invoice_number} · waiting to fill</Row>)}
      </Card>
      <Card title="Low stock" count={lowLots.length} accent="blue">
        {lowLots.length === 0 ? empty : lowLots.map(r =>
          <Row key={r.purchase_id} onClick={() => nav('/stock')}>{r.our_code} ({r.hsn_code}) · {r.balance_kg} kg</Row>)}
      </Card>
    </SimpleGrid>
  )
}
