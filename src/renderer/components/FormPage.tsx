import type { ReactNode } from 'react'
import { Paper, Group, Alert } from '@mantine/core'
import PageHeader from './PageHeader'
export default function FormPage({ title, onBack, error, footer, children }:
  { title: string; onBack: () => void; error?: string; footer: ReactNode; children: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} back={onBack} />
      {error && <Alert color="red" mb="md">{error}</Alert>}
      <Paper withBorder p="lg" radius="md">{children}</Paper>
      <Group justify="flex-end" mt="md">{footer}</Group>
    </div>
  )
}
