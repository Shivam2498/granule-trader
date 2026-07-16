import { DateInput } from '@mantine/dates'
export default function DateField({ value, onChange, id }: { value: string; onChange: (s: string) => void; id?: string }) {
  return (
    <DateInput id={id} valueFormat="DD/MM/YYYY"
      value={value ? new Date(value + 'T00:00:00') : null}
      onChange={d => onChange(d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')} />
  )
}
