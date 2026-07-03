import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Group, Button, Center, Loader, Alert, Stack } from '@mantine/core'
import type { Sale, SaleAllocation, Settings } from '@shared/types'
import InvoiceTemplate from '../invoice/InvoiceTemplate'

export default function InvoiceView() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState<{ sale: Sale; allocations: SaleAllocation[] } | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [hsnDescriptions, setHsnDescriptions] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { (async () => {
    try {
      if (!id) { setError('No invoice was specified.'); return }
      const sale = await window.api.getSaleWithAllocations(Number(id))
      if (!sale?.sale) { setError('That invoice could not be found. It may have been deleted.'); return }
      setData(sale)
      setSettings(await window.api.getSettings())
      const hsn = await window.api.listHsn()
      setHsnDescriptions(Object.fromEntries(hsn.map(h => [h.hsn_code, h.description])))
    } catch (e) {
      setError(`Couldn't load this invoice: ${(e as Error).message}`)
    }
  })() }, [id])
  if (error) return (
    <Stack p="md" maw={520}>
      <Alert color="red" title="Can't show this invoice">{error}</Alert>
      <Group><Button variant="default" onClick={() => nav('/sales')}>Back to sales</Button></Group>
    </Stack>
  )
  if (!data || !settings) return <Center h="60vh"><Loader /></Center>
  return (
    <div>
      <Group className="no-print" p="md">
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
        <Button variant="default" onClick={() => nav('/sales')}>Back to sales</Button>
      </Group>
      <InvoiceTemplate sale={data.sale} allocations={data.allocations} settings={settings} hsnDescriptions={hsnDescriptions} />
    </div>
  )
}
