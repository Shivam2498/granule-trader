import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { Group, Button } from '@mantine/core'
import type { Sale, SaleAllocation, Settings } from '@shared/types'
import InvoiceTemplate from '../invoice/InvoiceTemplate'

export default function InvoiceView() {
  const { id } = useParams()
  const nav = useNavigate()
  const [data, setData] = useState<{ sale: Sale; allocations: SaleAllocation[] } | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  useEffect(() => { (async () => {
    if (id) setData(await window.api.getSaleWithAllocations(Number(id)))
    setSettings(await window.api.getSettings())
  })() }, [id])
  if (!data || !settings) return <div className="content">Loading…</div>
  return (
    <div>
      <Group className="no-print" p="md">
        <Button onClick={() => window.print()}>Print / Save as PDF</Button>
        <Button variant="default" onClick={() => nav('/sales')}>Back to sales</Button>
      </Group>
      <InvoiceTemplate sale={data.sale} allocations={data.allocations} settings={settings} />
    </div>
  )
}
