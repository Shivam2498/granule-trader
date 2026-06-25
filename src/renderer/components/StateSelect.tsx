import { Select } from '@mantine/core'
import { INDIAN_STATES } from '@shared/indian-states'
export default function StateSelect({ value, onChange, id }: { value: string; onChange: (s: string) => void; id?: string }) {
  return (
    <Select id={id} data={INDIAN_STATES} value={value || null} searchable nothingFoundMessage="No match"
      placeholder="Select state" onChange={v => onChange(v ?? '')} />
  )
}
