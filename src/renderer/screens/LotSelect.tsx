import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Paper, Table, Checkbox, Select, TextInput, Button, Group, Text, Alert, Badge } from '@mantine/core'
import type { AvailableLot, HsnProduct } from '@shared/types'
import PageHeader from '../components/PageHeader'
import ListTable from '../components/ListTable'
import { formatINR } from '../lib/format'
import { filterLots } from '../lib/allocation'
import { daysBetween } from '../lib/dashboard'
import { useSaleDraft } from '../sale-draft'

const ALL = '__all__'

export default function LotSelect() {
  const nav = useNavigate()
  const { draft, addLots } = useSaleDraft()
  const [lots, setLots] = useState<AvailableLot[]>([])
  const [hsn, setHsn] = useState<HsnProduct[]>([])
  const [material, setMaterial] = useState(ALL)
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [error, setError] = useState('')

  // The sale's own draw must not count against it, or editing a sale would hide its own lots.
  const excludeSaleId = draft.key.startsWith('new') ? undefined : Number(draft.key.split(':')[1])

  useEffect(() => { (async () => {
    try {
      setHsn(await window.api.listHsn())
      setLots(await window.api.listAvailableLots(draft.invoiceDate, excludeSaleId))
    } catch (e: any) { setError(e.message ?? String(e)) }
  })() }, [draft.invoiceDate])

  const describe = useMemo(() => new Map(hsn.map(h => [h.hsn_code, h.description])), [hsn])
  const label = (code: string) => `${code}${describe.get(code) ? ` · ${describe.get(code)}` : ''}`

  const materials = useMemo(() => {
    const by = new Map<string, number>()
    for (const l of lots) by.set(l.hsn_code, (by.get(l.hsn_code) ?? 0) + l.available_kg)
    return [...by.entries()].sort((a, b) => b[1] - a[1])
  }, [lots])

  const visible = filterLots(lots, { hsn: material === ALL ? undefined : material, query })
  const visibleKg = visible.reduce((a, l) => a + l.available_kg, 0)

  function toggle(id: number) {
    setPicked(p => {
      const next = new Set(p)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function addSelected() {
    addLots([...picked])
    nav(-1)
  }

  const selectable = visible.filter(l => !(l.purchase_item_id in draft.lots))
  const allSelected = selectable.length > 0 && selectable.every(l => picked.has(l.purchase_item_id))

  return (
    <div>
      <PageHeader title="Choose stock to sell" back={() => nav(-1)} action={
        <Button disabled={picked.size === 0} onClick={addSelected}>
          Add {picked.size > 0 ? `${picked.size} lot${picked.size === 1 ? '' : 's'}` : 'lots'}
        </Button>
      } />
      {error && <Alert color="red" mb="md">{error}</Alert>}

      <Paper withBorder p="lg" radius="md" mb="md">
        <Group align="flex-end">
          <Select
            label="Material (HSN)"
            style={{ minWidth: 300 }}
            searchable
            data={[
              { value: ALL, label: `All materials — ${lots.reduce((a, l) => a + l.available_kg, 0)} kg` },
              ...materials.map(([code, kg]) => ({ value: code, label: `${label(code)} — ${kg} kg` }))
            ]}
            value={material}
            onChange={v => setMaterial(v ?? ALL)}
          />
          <TextInput
            label="Search"
            placeholder="Lot code or description"
            style={{ flex: 1 }}
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
          />
        </Group>
        <Text size="sm" c="dimmed" mt="sm">
          Showing {visible.length} of {lots.length} lots · {visibleKg} kg — available on {draft.invoiceDate}
        </Text>
      </Paper>

      <Paper withBorder p="lg" radius="md">
        <ListTable head={
          <>
            <Table.Th style={{ width: 44 }}>
              <Checkbox
                aria-label="Select all"
                checked={allSelected}
                onChange={e => setPicked(p => {
                  const next = new Set(p)
                  for (const l of selectable) e.currentTarget.checked ? next.add(l.purchase_item_id) : next.delete(l.purchase_item_id)
                  return next
                })}
              />
            </Table.Th>
            <Table.Th>Lot</Table.Th>
            <Table.Th>HSN</Table.Th>
            <Table.Th>Description</Table.Th>
            <Table.Th>Bought</Table.Th>
            <Table.Th ta="right">Age</Table.Th>
            <Table.Th ta="right">Available</Table.Th>
            <Table.Th ta="right">Cost/kg</Table.Th>
          </>
        }>
          {visible.map(l => {
            const already = l.purchase_item_id in draft.lots
            return (
              <Table.Tr key={l.purchase_item_id}>
                <Table.Td>
                  <Checkbox
                    aria-label={`Select ${l.our_code}`}
                    disabled={already}
                    checked={already || picked.has(l.purchase_item_id)}
                    onChange={() => toggle(l.purchase_item_id)}
                  />
                </Table.Td>
                <Table.Td>
                  {l.our_code}
                  {already && <Badge ml="xs" size="xs" color="gray">added</Badge>}
                </Table.Td>
                <Table.Td>{l.hsn_code}</Table.Td>
                <Table.Td>{l.description || '—'}</Table.Td>
                <Table.Td>{l.invoice_date}</Table.Td>
                <Table.Td ta="right">{daysBetween(l.invoice_date, draft.invoiceDate)}d</Table.Td>
                <Table.Td ta="right">{l.available_kg}</Table.Td>
                <Table.Td ta="right">{formatINR(l.rate_per_kg)}</Table.Td>
              </Table.Tr>
            )
          })}
          {visible.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={8} c="dimmed">
                {lots.length === 0
                  ? `No stock available on ${draft.invoiceDate}.`
                  : 'No lots match. Clear the search or choose another material.'}
              </Table.Td>
            </Table.Tr>
          )}
        </ListTable>
      </Paper>
    </div>
  )
}
