import { useState, useEffect } from 'react'
export default function SignedMoneyInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  const [text, setText] = useState(value === 0 ? '' : String(value))
  useEffect(() => { setText(value === 0 ? '' : String(value)) }, [value])
  return (
    <input id={id} type="text" inputMode="decimal" value={text}
      onChange={e => {
        const v = e.target.value
        if (v !== '' && v !== '-' && !/^-?\d*\.?\d*$/.test(v)) return
        setText(v)
        const n = (v === '' || v === '-') ? 0 : Number(v)
        onChange(Number.isNaN(n) ? 0 : n)
      }} />
  )
}
