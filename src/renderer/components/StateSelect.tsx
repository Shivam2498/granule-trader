import { INDIAN_STATES } from '@shared/indian-states'
export default function StateSelect({ value, onChange, id }: { value: string; onChange: (s: string) => void; id?: string }) {
  return (
    <select id={id} value={value} onChange={e => onChange(e.target.value)}>
      <option value="">— select state —</option>
      {INDIAN_STATES.map(s => <option key={s} value={s}>{s}</option>)}
    </select>
  )
}
