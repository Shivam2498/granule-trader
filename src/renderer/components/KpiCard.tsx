import type { ReactNode } from 'react'
import { Paper, Text } from '@mantine/core'
export default function KpiCard({ label, value, sub, onClick }: { label: string; value: string; sub?: ReactNode; onClick?: () => void }) {
  return (
    <Paper withBorder p="lg" radius="md" onClick={onClick}
      style={{ flex: 1, minWidth: 200, cursor: onClick ? 'pointer' : undefined }}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="28px">{value}</Text>
      {sub && <Text size="sm">{sub}</Text>}
    </Paper>
  )
}
