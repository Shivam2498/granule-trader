import { useState } from 'react'
import {
  Container, Paper, Title, Divider, Group, TextInput, Textarea,
  Button, Alert, SimpleGrid, Input
} from '@mantine/core'
import { isGstin, isPan, isMobile, isPincode, deriveInvoicePrefix } from '@shared/validation'
import StateSelect from '../components/StateSelect'
import PincodeField from '../components/PincodeField'

export default function FirstRun({ onDone }: { onDone: () => void }) {
  const [folder, setFolder] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [prefix, setPrefix] = useState('')
  const [prefixEdited, setPrefixEdited] = useState(false)
  const [gstin, setGstin] = useState('')
  const [pan, setPan] = useState('')
  const [mobile, setMobile] = useState('')
  const [homeState, setHomeState] = useState('')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [pincode, setPincode] = useState('')
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)

  function setBusinessName(v: string) {
    setName(v)
    if (!prefixEdited) setPrefix(deriveInvoicePrefix(v))
  }
  async function pick() { const f = await window.api.chooseDataFolder(); if (f) setFolder(f) }

  const valid =
    !!folder && name.trim().length > 0 && isGstin(gstin) && isPan(pan) &&
    isMobile(mobile) && homeState.trim().length > 0 && prefix.trim().length > 0 &&
    (pincode === '' || isPincode(pincode))

  // A required field shows "Required" once the user has tried to submit; a filled-but-invalid
  // field shows its format message immediately. This is how the button tells you what's missing.
  const reqErr = (v: string) => (attempted && !v.trim() ? 'Required' : undefined)

  async function start() {
    setError('')
    if (!valid) {
      setAttempted(true)
      setError('Please complete the highlighted fields below.')
      return
    }
    try {
      await window.api.saveSettings({
        seller_name: name.trim(), seller_gstin: gstin.trim().toUpperCase(), seller_pan: pan.trim().toUpperCase(),
        seller_phone: mobile.trim(), seller_address: address.trim(),
        seller_city: city.trim(), seller_pincode: pincode.trim(), home_state: homeState,
        invoice_prefix: prefix.trim().toUpperCase()
      })
      onDone()
    } catch (e: any) { setError(e.message ?? String(e)) }
  }

  return (
    <Container size="sm" py="xl">
      <Title order={1} ta="center">Welcome to Granule Trader</Title>
      <p style={{ textAlign: 'center', marginTop: 4, color: 'var(--mantine-color-dimmed)' }}>
        A one-time setup of your business details.
      </p>
      {error && <Alert color="red" mb="md">{error}</Alert>}

      <Paper withBorder p="xl" radius="md">
        <Title order={3}>Data file</Title>
        <Divider mb="md" />
        <Group align="flex-start">
          <TextInput
            style={{ flex: 1 }}
            disabled
            value={folder ?? ''}
            placeholder="Choose a folder for your data file…"
            error={attempted && !folder ? 'Choose a data folder' : undefined}
          />
          <Button onClick={pick}>Choose…</Button>
        </Group>
        <p style={{ fontSize: 14, color: 'var(--mantine-color-dimmed)', marginTop: 8 }}>
          A cloud-synced folder (Dropbox/Drive/iCloud) lets a second computer use the same data — open it on one computer at a time.
        </p>

        <Title order={3} mt="lg">Your business</Title>
        <Divider mb="md" />
        <SimpleGrid cols={{ base: 1, sm: 2 }}>
          <TextInput
            label="Business name"
            withAsterisk
            value={name}
            onChange={e => setBusinessName(e.currentTarget.value)}
            placeholder="e.g. Ramaxton Plastocrafts"
            error={reqErr(name)}
            style={{ gridColumn: 'span 2' }}
          />
          <TextInput
            label="Invoice prefix (auto from name, editable)"
            withAsterisk
            value={prefix}
            onChange={e => { setPrefix(e.currentTarget.value.toUpperCase()); setPrefixEdited(true) }}
            error={reqErr(prefix)}
          />
          <TextInput
            label="Mobile"
            withAsterisk
            value={mobile}
            onChange={e => setMobile(e.currentTarget.value.replace(/\D/g, '').slice(0, 10))}
            placeholder="10 digits"
            error={mobile.length > 0 && !isMobile(mobile) ? 'Enter a 10-digit mobile number' : reqErr(mobile)}
          />
          <TextInput
            label="GSTIN"
            withAsterisk
            value={gstin}
            onChange={e => setGstin(e.currentTarget.value.toUpperCase())}
            placeholder="24ABCDE1234F1Z5"
            error={gstin.length > 0 && !isGstin(gstin) ? 'GSTIN must be 15 characters, e.g. 24ABCDE1234F1Z5' : reqErr(gstin)}
          />
          <TextInput
            label="PAN"
            withAsterisk
            value={pan}
            onChange={e => setPan(e.currentTarget.value.toUpperCase())}
            placeholder="ABCDE1234F"
            error={pan.length > 0 && !isPan(pan) ? 'PAN must be 10 characters, e.g. ABCDE1234F' : reqErr(pan)}
          />
          <Input.Wrapper
            label="Pincode"
            error={pincode.length > 0 && !isPincode(pincode) ? '6-digit pincode' : undefined}
          >
            <PincodeField
              value={pincode}
              onChange={setPincode}
              onResolved={r => { setCity(r.city); setHomeState(r.state) }}
            />
          </Input.Wrapper>
          <TextInput
            label="City"
            value={city}
            onChange={e => setCity(e.currentTarget.value)}
          />
          <Textarea
            label="Street address"
            autosize
            minRows={2}
            value={address}
            onChange={e => setAddress(e.currentTarget.value)}
            style={{ gridColumn: 'span 2' }}
          />
          <Input.Wrapper label="Home state (for tax)" withAsterisk error={reqErr(homeState)}>
            <StateSelect value={homeState} onChange={setHomeState} />
          </Input.Wrapper>
        </SimpleGrid>

        <Group justify="flex-end" mt="md">
          <Button onClick={start}>Start using Granule Trader</Button>
        </Group>
      </Paper>
    </Container>
  )
}
