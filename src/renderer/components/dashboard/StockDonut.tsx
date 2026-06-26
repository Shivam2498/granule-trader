import { useNavigate } from 'react-router-dom'
import { Paper, Title, Text } from '@mantine/core'
import { DonutChart } from '@mantine/charts'
import type { StockSlice } from '../../lib/dashboard'

const PALETTE = ['teal.6', 'blue.6', 'grape.6', 'orange.6', 'cyan.6', 'lime.6', 'pink.6', 'indigo.6']

export default function StockDonut({ data }: { data: StockSlice[] }) {
  const nav = useNavigate()
  const chartData = data.map((s, i) => ({ name: s.hsn, value: Math.round(s.kg), color: PALETTE[i % PALETTE.length] }))
  return (
    <Paper withBorder p="lg" radius="md" onClick={() => nav('/stock')} style={{ cursor: 'pointer' }}>
      <Title order={3} mb="md">Stock by product (kg)</Title>
      {chartData.length === 0 ? <Text c="dimmed">No stock on hand.</Text> :
        <DonutChart h={240} data={chartData} withLabels withTooltip />}
    </Paper>
  )
}
