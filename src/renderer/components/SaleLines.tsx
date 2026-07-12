import { useMemo, useState } from 'react'
import { Paper, Text, Group, Select, Button, Table, Input, Collapse, ActionIcon, Anchor, Stack } from '@mantine/core'
import type { AvailableLot, HsnProduct } from '@shared/types'
import MoneyInput from './MoneyInput'
import { formatINR } from '../lib/format'
import {
  type SaleLineDraft, newLine, reallocate, lotsOf, availableOf, allocatedQty,
  lineAmount, weightedCost, lineError
} from '../lib/sale-lines'

export interface SaleLinesProps {
  lots: AvailableLot[]
  hsn: HsnProduct[]
  asOfDate: string
  lines: SaleLineDraft[]
  onChange(next: SaleLineDraft[]): void
}

export default function SaleLines({ lots, hsn, asOfDate, lines, onChange }: SaleLinesProps) {
  const [material, setMaterial] = useState<string | null>(null)
  const [qty, setQty] = useState(0)
  const [rate, setRate] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)   // hsn whose lots are being hand-picked

  const describe = useMemo(() => new Map(hsn.map(h => [h.hsn_code, h.description])), [hsn])
  const label = (code: string) => `${code}${describe.get(code) ? ` · ${describe.get(code)}` : ''}`

  // A material already on the invoice cannot be added twice — its rate is agreed once.
  const taken = new Set(lines.map(l => l.hsn_code))
  const materials = useMemo(() => {
    const by = new Map<string, number>()
    for (const l of lots) if (!taken.has(l.hsn_code)) by.set(l.hsn_code, (by.get(l.hsn_code) ?? 0) + l.available_kg)
    return [...by.entries()].sort((a, b) => b[1] - a[1])
  }, [lots, lines])

  const stockOfPicked = material ? availableOf(lots, material) : 0
  const short = !!material && qty > stockOfPicked
  const canAdd = !!material && qty > 0 && rate > 0 && !short

  function add() {
    if (!canAdd || !material) return
    onChange([...lines, newLine(lots, material, qty, rate)])
    setMaterial(null); setQty(0); setRate(0)
  }

  function patch(i: number, p: Partial<SaleLineDraft>) {
    const next = lines.map((l, j) => (j === i ? { ...l, ...p } : l))
    // A quantity change re-runs the oldest-first fill, unless the user has taken the lots over.
    if (p.qty_kg !== undefined) next[i] = reallocate(next[i], lots)
    onChange(next)
  }
  function removeLine(i: number) { onChange(lines.filter((_, j) => j !== i)) }

  function patchAllocation(i: number, itemId: number, q: number) {
    const line = lines[i]
    const allocations = line.allocations.some(a => a.purchase_item_id === itemId)
      ? line.allocations.map(a => (a.purchase_item_id === itemId ? { ...a, qty: q } : a))
      : [...line.allocations, { purchase_item_id: itemId, qty: q }]
    onChange(lines.map((l, j) => (j === i ? { ...l, manual: true, allocations } : l)))
  }

  function backToAuto(i: number) {
    const line = { ...lines[i], manual: false }
    onChange(lines.map((l, j) => (j === i ? reallocate(line, lots) : l)))
  }

  const totalQty = lines.reduce((a, l) => a + l.qty_kg, 0)
  const totalAmt = lines.reduce((a, l) => a + lineAmount(l), 0)
  const byId = new Map(lots.map(l => [l.purchase_item_id, l]))

  return (
    <>
      {/* You describe the deal — material, quantity, price. The app picks the lots. */}
      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="md">What are you selling?</Text>
        <Group align="flex-start">
          <Select
            label="Material"
            placeholder="Choose a material"
            searchable
            style={{ minWidth: 280 }}
            data={materials.map(([code, kg]) => ({ value: code, label: `${label(code)} — ${kg} kg` }))}
            value={material}
            onChange={v => { setMaterial(v); setQty(0) }}
            nothingFoundMessage={lots.length === 0 ? 'No stock available' : 'Everything in stock is already on this invoice'}
          />
          <Input.Wrapper
            label="Quantity (kg)"
            description={material ? `${stockOfPicked} kg available` : ' '}
            error={short ? `Only ${stockOfPicked} kg available.` : undefined}
          >
            <MoneyInput value={qty} onChange={setQty} />
          </Input.Wrapper>
          <Input.Wrapper label="Selling rate (per kg)" description=" ">
            <MoneyInput value={rate} onChange={setRate} />
          </Input.Wrapper>
          <Input.Wrapper label="Amount" description=" ">
            <Text fw={600} pt={6}>{formatINR(qty * rate)}</Text>
          </Input.Wrapper>
          <Button mt={25} onClick={add} disabled={!canAdd}>Add to invoice</Button>
        </Group>
        {lots.length === 0 && <Text c="red" size="sm" mt="sm">No stock available on {asOfDate}.</Text>}
      </Paper>

      <Paper withBorder p="lg" radius="md" mb="md">
        <Text fw={600} mb="md">On this invoice</Text>

        {lines.length === 0 && <Text c="dimmed">Nothing added yet — choose a material above.</Text>}

        <Stack gap="sm">
          {lines.map((line, i) => {
            const err = lineError(line, lots)
            const cost = weightedCost(line, lots)
            const margin = line.rate_per_kg - cost
            const open = expanded === line.hsn_code
            const drawnFrom = line.allocations
              .map(a => byId.get(a.purchase_item_id)?.our_code)
              .filter(Boolean)
            return (
              <Paper key={line.hsn_code} withBorder p="md" radius="sm">
                <Group align="flex-start" wrap="nowrap">
                  <div style={{ minWidth: 200, flex: 1 }}>
                    <Text fw={600}>{label(line.hsn_code)}</Text>
                    <Text size="xs" c="dimmed">
                      from {drawnFrom.length ? drawnFrom.join(' · ') : '—'}
                    </Text>
                  </div>
                  <Input.Wrapper label="Qty (kg)" style={{ width: 130 }}>
                    <MoneyInput value={line.qty_kg} onChange={n => patch(i, { qty_kg: n })} />
                  </Input.Wrapper>
                  <Input.Wrapper label="Rate/kg" style={{ width: 130 }}>
                    <MoneyInput value={line.rate_per_kg} onChange={n => patch(i, { rate_per_kg: n })} />
                  </Input.Wrapper>
                  <div style={{ width: 150, textAlign: 'right' }}>
                    <Text size="xs" c="dimmed">Amount</Text>
                    <Text fw={600}>{formatINR(lineAmount(line))}</Text>
                  </div>
                  <ActionIcon variant="subtle" color="red" mt={24}
                    aria-label={`Remove ${line.hsn_code}`} onClick={() => removeLine(i)}>✕</ActionIcon>
                </Group>

                <Group mt="xs" gap="lg">
                  <Text size="xs" c="dimmed">
                    cost {formatINR(cost)}/kg
                    {line.rate_per_kg > 0 && (
                      margin < 0
                        ? <Text span c="red" fw={600}> → {formatINR(Math.abs(margin))}/kg below cost</Text>
                        : <Text span c="teal" fw={600}> → +{formatINR(margin)}/kg margin</Text>
                    )}
                  </Text>
                  <Anchor size="xs" onClick={() => setExpanded(open ? null : line.hsn_code)}>
                    {open ? 'hide lots' : 'change lots'}
                  </Anchor>
                  {line.manual && (
                    <Anchor size="xs" c="dimmed" onClick={() => backToAuto(i)}>use oldest first</Anchor>
                  )}
                </Group>

                {err && <Text c="red" size="sm" mt="xs">{err}</Text>}

                {/* The escape hatch: when the specific lot matters, take the lots over by hand. */}
                <Collapse in={open}>
                  <Table mt="sm" verticalSpacing="xs">
                    <Table.Thead>
                      <Table.Tr>
                        <Table.Th>Lot</Table.Th>
                        <Table.Th>Bought</Table.Th>
                        <Table.Th ta="right">Available</Table.Th>
                        <Table.Th ta="right">Cost/kg</Table.Th>
                        <Table.Th style={{ width: 140 }}>Take (kg)</Table.Th>
                      </Table.Tr>
                    </Table.Thead>
                    <Table.Tbody>
                      {lotsOf(lots, line.hsn_code).map(l => (
                        <Table.Tr key={l.purchase_item_id}>
                          <Table.Td>{l.our_code}</Table.Td>
                          <Table.Td>{l.invoice_date}</Table.Td>
                          <Table.Td ta="right">{l.available_kg}</Table.Td>
                          <Table.Td ta="right">{formatINR(l.rate_per_kg)}</Table.Td>
                          <Table.Td>
                            <MoneyInput
                              value={line.allocations.find(a => a.purchase_item_id === l.purchase_item_id)?.qty ?? 0}
                              onChange={n => patchAllocation(i, l.purchase_item_id, n)}
                            />
                          </Table.Td>
                        </Table.Tr>
                      ))}
                    </Table.Tbody>
                  </Table>
                  <Text size="xs" c="dimmed" mt={4}>
                    Lots take {allocatedQty(line)} kg of the {line.qty_kg} kg on this line.
                  </Text>
                </Collapse>
              </Paper>
            )
          })}
        </Stack>

        {lines.length > 0 && (
          <Group justify="flex-end" mt="md" gap="xl">
            <Text fw={700}>{totalQty} kg</Text>
            <Text fw={700}>{formatINR(totalAmt)}</Text>
          </Group>
        )}
      </Paper>
    </>
  )
}
