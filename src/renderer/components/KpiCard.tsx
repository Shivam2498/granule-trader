import { Paper, Text } from '@mantine/core'
export default function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Paper withBorder p="lg" radius="md" style={{ flex: 1, minWidth: 200 }}>
      <Text size="sm" c="dimmed">{label}</Text>
      <Text fw={700} size="28px">{value}</Text>
    </Paper>
  )
}
