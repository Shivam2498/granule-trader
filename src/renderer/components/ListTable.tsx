import type { ReactNode } from 'react'
import { Table } from '@mantine/core'
import './list-table.css'
export default function ListTable({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    // Wide tables (e.g. the full sales statement) scroll inside their own box on screen instead of
    // pushing past the right edge of the page; list-table.css lifts that clip for print.
    <div className="list-table-scroll">
      <Table striped highlightOnHover verticalSpacing="sm" horizontalSpacing="md">
        <Table.Thead><Table.Tr>{head}</Table.Tr></Table.Thead>
        <Table.Tbody>{children}</Table.Tbody>
      </Table>
    </div>
  )
}
