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
        setText(v)
        const trimmed = v.trim()
        onChange(trimmed === '' ? 0 : (Number.isNaN(Number(trimmed)) ? value : Number(trimmed)))
      }} />
  )
}
