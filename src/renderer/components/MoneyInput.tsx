import { useState, useEffect } from 'react'

export default function MoneyInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  const [text, setText] = useState(value === 0 ? '' : String(value))

  useEffect(() => {
    setText(value === 0 ? '' : String(value))
  }, [value])

  return (
    <input id={id} type="text" inputMode="decimal" value={text}
      onChange={e => {
        const v = e.target.value
        if (v !== '' && !/^\d*\.?\d*$/.test(v)) return   // reject non-numeric keystrokes
        setText(v)
        const trimmed = v.trim()
        onChange(trimmed === '' ? 0 : Number(trimmed))
      }} />
  )
}
