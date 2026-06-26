import { useState } from 'react'
import { Paper, Group, Title, SegmentedControl, Text } from '@mantine/core'
import { BarChart } from '@mantine/charts'
import type { MonthPoint } from '../../lib/dashboard'

export default function TrendChart({ data }: { data: MonthPoint[] }) {
  const [mode, setMode] = useState<'amt' | 'kg'>('amt')
  const series = mode === 'amt'
    ? [{ name: 'salesAmt', label: 'Sales ₹', color: 'teal.6' }, { name: 'purchAmt', label: 'Purchases ₹', color: 'blue.6' }]
    : [{ name: 'salesKg', label: 'Sales kg', color: 'teal.6' }, { name: 'purchKg', label: 'Purchases kg', color: 'blue.6' }]
  return (
    <Paper withBorder p="lg" radius="md">
      <Group justify="space-between" mb="md">
        <Title order={3}>Sales vs Purchases</Title>
        <SegmentedControl size="xs" value={mode} onChange={v => setMode(v as 'amt' | 'kg')}
          data={[{ label: '₹', value: 'amt' }, { label: 'kg', value: 'kg' }]} />
      </Group>
      {data.length === 0 ? <Text c="dimmed">No activity this year yet.</Text> :
        <BarChart h={260} data={data} dataKey="label" series={series} withLegend tickLine="y" />}
    </Paper>
  )
}
