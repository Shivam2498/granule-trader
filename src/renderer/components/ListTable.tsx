import type { ReactNode } from 'react'
import { Table } from '@mantine/core'
export default function ListTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
      <Table.Thead><Table.Tr>{head}</Table.Tr></Table.Thead>
      <Table.Tbody>{children}</Table.Tbody>
    </Table>
  )
}
