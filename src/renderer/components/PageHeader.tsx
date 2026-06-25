import type { ReactNode } from 'react'
import { Group, Title, Button } from '@mantine/core'
import { IconChevronLeft } from '@tabler/icons-react'
export default function PageHeader({ title, action, back }: { title: string; action?: ReactNode; back?: () => void }) {
  return (
    <Group justify="space-between" mb="lg" wrap="nowrap">
      <Group gap="xs">
        {back && <Button variant="subtle" leftSection={<IconChevronLeft size={18} />} onClick={back} px="xs">Back</Button>}
        <Title order={1}>{title}</Title>
      </Group>
      {action}
    </Group>
  )
}
