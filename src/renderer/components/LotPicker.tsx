import { useMemo, useState } from 'react'
import { Paper, Text, Group, Select, TextInput, Button, Table, ScrollArea, Alert, ActionIcon, Input } from '@mantine/core'
import type { AvailableLot, HsnProduct } from '@shared/types'
import MoneyInput from './MoneyInput'
import { filterLots, fifoFill } from '../lib/allocation'
import { formatINR } from '../lib/format'
import { daysBetween } from '../lib/dashboard'

/** What the sale is drawing from one lot. Presence in the record means the lot is on the sale. */
export interface Draw { qty: number; rate: number }

export interface LotPickerProps {
  lots: AvailableLot[]
  hsn: HsnProduct[]
  asOfDate: string
  chosen: Record<number, Draw>
  onChange(next: Record<number, Draw>): void
}

const ALL = '__all__'

export default function LotPicker({ lots, hsn, asOfDate, chosen, onChange }: LotPickerProps) {
  const [material, setMaterial] = useState<string>(ALL)
  const [query, setQuery] = useState('')
  const [fillQty, setFillQty] = useState(0)
  const [fillNote, setFillNote] = useState<string | null>(null)

  const describe = useMemo(
    () => new Map(hsn.map(h => [h.hsn_code, h.description])),
    [hsn]
  )

  // Lots already on the sale drop out of the finder — you cannot add the same lot twice, and a
  // FIFO fill should top up from lots you have NOT already picked rather than fight your choices.
  const unpicked = useMemo(() => lots.filter(l => !(l.purchase_item_id in chosen)), [lots, chosen])

  const materials = useMemo(() => {
    const by = new Map<string, number>()
    for (const l of unpicked) by.set(l.hsn_code, (by.get(l.hsn_code) ?? 0) + l.available_kg)
    return [...by.entries()].sort((a, b) => b[1] - a[1])
  }, [unpicked])

  const visible = useMemo(
    () => filterLots(unpicked, { hsn: material === ALL ? undefined : material, query }),
    [unpicked, material, query]
  )
  const visibleKg = visible.reduce((a, l) => a + l.available_kg, 0)

  function add(lot: AvailableLot, qty = 0) {
    onChange({ ...chosen, [lot.purchase_item_id]: { qty, rate: chosen[lot.purchase_item_id]?.rate ?? 0 } })
  }
  function remove(itemId: number) {
    const next = { ...chosen }
    delete next[itemId]
    onChange(next)
  }
  function patch(itemId: number, p: Partial<Draw>) {
    onChange({ ...chosen, [itemId]: { ...chosen[itemId], ...p } })
  }

  function runFifoFill() {
    setFillNote(null)
    if (material === ALL) { setFillNote('Choose a material first, then a quantity.'); return }
    if (fillQty <= 0) { setFillNote('Enter how many kg you want to sell.'); return }
    const { draws, shortfall } = fifoFill(unpicked, material, fillQty)
    if (draws.length === 0) {
      setFillNote(`There is no ${material} stock available on ${asOfDate}.`)
      return
    }
    const next = { ...chosen }
    for (const d of draws) next[d.purchase_item_id] = { qty: d.qty, rate: next[d.purchase_item_id]?.rate ?? 0 }
    onChange(next)
    setFillQty(0)
    setFillNote(shortfall > 0
      ? `Added ${draws.length} lot${draws.length === 1 ? '' : 's'}, but only ${fillQty - shortfall} kg was available — ${shortfall} kg short. Enter the rest by hand or pick another material.`
      : `Added ${draws.length} lot${draws.length === 1 ? '' : 's'}, oldest first. Now enter the selling rate.`)
  }

  const chosenLots = lots.filter(l => l.purchase_item_id in chosen)
  const totalQty = chosenLots.reduce((a, l) => a + (chosen[l.purchase_item_id]?.qty ?? 0), 0)
  const totalAmt = chosenLots.reduce((a, l) => {
    const d = chosen[l.purchase_item_id]
    return a + (d?.qty ?? 0) * (d?.rate ?? 0)
  }, 0)

  return (
    <>
      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="xs">Add stock to this sale</Text>
        <Text c="dimmed" size="sm" mb="md">Lots available on {asOfDate}, oldest first.</Text>

        <Group align="flex-end" mb="sm">
          <Select
            label="Material"
            style={{ minWidth: 260 }}
            data={[
              { value: ALL, label: 'All materials' },
              ...materials.map(([code, kg]) => ({
                value: code,
                label: `${code}${describe.get(code) ? ` · ${describe.get(code)}` : ''} — ${kg} kg`
              }))
            ]}
            value={material}
            onChange={v => { setMaterial(v ?? ALL); setFillNote(null) }}
          />
          <TextInput
            label="Search"
            placeholder="Lot code or description"
            style={{ flex: 1 }}
            value={query}
            onChange={e => setQuery(e.currentTarget.value)}
          />
        </Group>

        {/* The FIFO fast path: most sales just clear the oldest stock of one material. */}
        <Group align="flex-end" mb="sm">
          <Input.Wrapper label="Fill oldest first (kg)">
            <MoneyInput value={fillQty} onChange={setFillQty} />
          </Input.Wrapper>
          <Button variant="default" onClick={runFifoFill} disabled={material === ALL || fillQty <= 0}>Fill</Button>
          <Text c="dimmed" size="sm">
            {material === ALL ? 'Pick a material to fill automatically.' : 'Adds the oldest lots until the quantity is met.'}
          </Text>
        </Group>
        {fillNote && <Alert color="blue" variant="light" mb="sm" onClose={() => setFillNote(null)} withCloseButton>{fillNote}</Alert>}

        <Text size="sm" c="dimmed" mb="xs">
          {visible.length} lot{visible.length === 1 ? '' : 's'} · {visibleKg} kg available
        </Text>

        <ScrollArea.Autosize mah={220} type="auto">
          <Table stickyHeader highlightOnHover verticalSpacing="xs">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Lot</Table.Th>
                <Table.Th>HSN</Table.Th>
                <Table.Th>Bought</Table.Th>
                <Table.Th ta="right">Age</Table.Th>
                <Table.Th ta="right">Available</Table.Th>
                <Table.Th ta="right">Cost/kg</Table.Th>
                <Table.Th />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {visible.map(l => (
                <Table.Tr key={l.purchase_item_id}>
                  <Table.Td>{l.our_code}</Table.Td>
                  <Table.Td>{l.hsn_code}</Table.Td>
                  <Table.Td>{l.invoice_date}</Table.Td>
                  <Table.Td ta="right">{daysBetween(l.invoice_date, asOfDate)}d</Table.Td>
                  <Table.Td ta="right">{l.available_kg}</Table.Td>
                  <Table.Td ta="right">{formatINR(l.rate_per_kg)}</Table.Td>
                  <Table.Td ta="right">
                    <Button size="compact-sm" variant="light" onClick={() => add(l)}>Add</Button>
                  </Table.Td>
                </Table.Tr>
              ))}
              {visible.length === 0 && (
                <Table.Tr>
                  <Table.Td colSpan={7} c="dimmed">
                    {lots.length === 0
                      ? `No stock available on ${asOfDate}.`
                      : 'No lots match. Clear the search or choose another material.'}
                  </Table.Td>
                </Table.Tr>
              )}
            </Table.Tbody>
          </Table>
        </ScrollArea.Autosize>
      </Paper>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="md">Selling from these lots</Text>
        <Table verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Lot</Table.Th>
              <Table.Th>HSN</Table.Th>
              <Table.Th ta="right">Available</Table.Th>
              <Table.Th style={{ width: 140 }}>Sell/kg</Table.Th>
              <Table.Th style={{ width: 140 }}>Qty (kg)</Table.Th>
              <Table.Th ta="right">Amount</Table.Th>
              <Table.Th style={{ width: 44 }} />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {chosenLots.map(l => {
              const d = chosen[l.purchase_item_id]
              const over = d.qty > l.available_kg
              return (
                <Table.Tr key={l.purchase_item_id}>
                  <Table.Td>{l.our_code}</Table.Td>
                  <Table.Td>{l.hsn_code}</Table.Td>
                  <Table.Td ta="right">{l.available_kg}</Table.Td>
                  <Table.Td>
                    <MoneyInput value={d.rate} onChange={n => patch(l.purchase_item_id, { rate: n })} />
                  </Table.Td>
                  <Table.Td>
                    <MoneyInput value={d.qty} onChange={n => patch(l.purchase_item_id, { qty: n })} />
                    {over && <Text c="red" size="xs" mt={4}>Only {l.available_kg} kg available.</Text>}
                  </Table.Td>
                  <Table.Td ta="right">{formatINR(d.qty * d.rate)}</Table.Td>
                  <Table.Td>
                    <ActionIcon variant="subtle" color="red" aria-label={`Remove ${l.our_code}`}
                      onClick={() => remove(l.purchase_item_id)}>✕</ActionIcon>
                  </Table.Td>
                </Table.Tr>
              )
            })}
            {chosenLots.length === 0 && (
              <Table.Tr><Table.Td colSpan={7} c="dimmed">No lots chosen yet — add stock above.</Table.Td></Table.Tr>
            )}
          </Table.Tbody>
        </Table>
        {chosenLots.length > 0 && (
          <Group justify="flex-end" mt="md" gap="xl">
            <Text fw={600}>{totalQty} kg</Text>
            <Text fw={600}>{formatINR(totalAmt)}</Text>
          </Group>
        )}
      </Paper>
    </>
  )
}
