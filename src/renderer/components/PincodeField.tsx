import { lookupPincode } from '../lib/pincode'
export default function PincodeField({ value, onChange, onResolved, id }:
  { value: string; onChange: (s: string) => void; onResolved: (r: { city: string; state: string }) => void; id?: string }) {
  return (
    <input id={id} type="text" inputMode="numeric" maxLength={6} value={value}
      onChange={e => {
        const v = e.target.value.replace(/\D/g, '').slice(0, 6)
        onChange(v)
        if (v.length === 6) { const r = lookupPincode(v); if (r) onResolved(r) }
      }} />
  )
}
