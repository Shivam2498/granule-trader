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
