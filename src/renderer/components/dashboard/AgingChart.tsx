import { Paper, Title } from '@mantine/core'
import { BarChart } from '@mantine/charts'
import type { AgingBuckets } from '../../lib/dashboard'

export default function AgingChart({ receivables, payables }: { receivables: AgingBuckets; payables: AgingBuckets }) {
  const data = [
    { bucket: '0–30 days', Receivables: receivables.b0_30, Payables: payables.b0_30 },
    { bucket: '31–60 days', Receivables: receivables.b31_60, Payables: payables.b31_60 },
    { bucket: '61+ days', Receivables: receivables.b60plus, Payables: payables.b60plus },
  ]
  return (
    <Paper withBorder p="lg" radius="md">
      <Title order={3} mb="md">Receivables & Payables aging</Title>
      <BarChart h={240} data={data} dataKey="bucket" withLegend
        series={[{ name: 'Receivables', color: 'orange.6' }, { name: 'Payables', color: 'red.6' }]} />
    </Paper>
  )
}
