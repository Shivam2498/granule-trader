import { useNavigate } from 'react-router-dom'
import { SimpleGrid, Paper, Group, Text, Badge, UnstyledButton } from '@mantine/core'
import type { Sale, Purchase } from '@shared/types'
import type { LowMaterial } from '../../lib/dashboard'
import { formatINR } from '../../lib/format'

interface ActionCenterProps {
  dueP: Purchase[]
  overdue: Array<{ sale: Sale; daysOld: number }>
  reserved: Sale[]
  lowMaterials: LowMaterial[]
}

/**
 * Each card is a COUNT and a headline, not a list. Listing every overdue invoice here duplicated the
 * Sales screen and buried the dashboard; the card now says how many and how much, and hands you off
 * to the filtered list to actually work through them.
 */
function Card({ title, count, accent, headline, onClick }: {
  title: string; count: number; accent: string; headline: string; onClick: () => void
}) {
  const idle = count === 0
  return (
    <UnstyledButton onClick={idle ? undefined : onClick} style={{ cursor: idle ? 'default' : 'pointer' }}>
      <Paper withBorder p="md" radius="md" h="100%">
        <Group justify="space-between" mb={4}>
          <Text fw={600}>{title}</Text>
          <Badge color={idle ? 'gray' : accent}>{count}</Badge>
        </Group>
        <Text size="sm" c={idle ? 'dimmed' : undefined}>{idle ? 'Nothing to do.' : headline}</Text>
      </Paper>
    </UnstyledButton>
  )
}

export default function ActionCenter({ dueP, overdue, reserved, lowMaterials }: ActionCenterProps) {
  const nav = useNavigate()
  const overdueAmt = overdue.reduce((a, o) => a + o.sale.total_invoice_amount, 0)
  const dueAmt = dueP.reduce((a, p) => a + p.total_invoice_amount, 0)
  const oldest = overdue[0]?.daysOld ?? 0

  return (
    <SimpleGrid cols={{ base: 1, sm: 2, lg: 4 }} mb="lg">
      <Card
        title="Money to collect" count={overdue.length} accent="orange"
        headline={`${formatINR(overdueAmt)} owed · oldest ${oldest} days`}
        onClick={() => nav('/sales?unpaid=1')}
      />
      <Card
        title="Bills to pay" count={dueP.length} accent="red"
        headline={`${formatINR(dueAmt)} outstanding`}
        onClick={() => nav('/purchases?unpaid=1')}
      />
      <Card
        title="Invoices to fill" count={reserved.length} accent="yellow"
        headline={`${reserved.length} reserved number${reserved.length === 1 ? '' : 's'} still blank`}
        onClick={() => nav('/sales')}
      />
      <Card
        title="Running low" count={lowMaterials.length} accent="blue"
        headline={lowMaterials.length
          ? `${lowMaterials[0].hsn} down to ${lowMaterials[0].kg} kg${lowMaterials.length > 1 ? ` (+${lowMaterials.length - 1} more)` : ''}`
          : ''}
        onClick={() => nav('/stock')}
      />
    </SimpleGrid>
  )
}
