import { DateInput } from '@mantine/dates'

// Typed input is parsed deterministically as DD/MM/YYYY rather than relying on the picker's
// locale/format guessing — a mis-read date on an invoice is exactly what we can't afford. The
// calendar popup is unaffected. Everything still stored/emitted as ISO YYYY-MM-DD.
export function parseDdmmyyyy(v: string): Date | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v.trim())
  if (!m) return null
  const [, dd, mm, yyyy] = m
  const d = new Date(Number(yyyy), Number(mm) - 1, Number(dd))
  // Reject impossible dates (e.g. 31/02): the round-trip must land on the same day.
  return d.getFullYear() === Number(yyyy) && d.getMonth() === Number(mm) - 1 && d.getDate() === Number(dd) ? d : null
}

export default function DateField({ value, onChange, id }: { value: string; onChange: (s: string) => void; id?: string }) {
  return (
    <DateInput id={id} valueFormat="DD/MM/YYYY"
      dateParser={parseDdmmyyyy}
      value={value ? new Date(value + 'T00:00:00') : null}
      onChange={d => onChange(d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '')} />
  )
}
