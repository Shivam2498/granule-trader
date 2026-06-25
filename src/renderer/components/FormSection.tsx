import type { ReactNode } from 'react'
import { Stack, Title, Divider, SimpleGrid } from '@mantine/core'
export default function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Stack gap="xs" mb="lg">
      <Title order={3}>{title}</Title>
      <Divider />
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="md">{children}</SimpleGrid>
    </Stack>
  )
}
