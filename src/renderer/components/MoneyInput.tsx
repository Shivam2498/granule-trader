import { NumberInput } from '@mantine/core'

// `decimals` controls how many digits are allowed after the point. Money is 2 by default; per-kg
// rates can be 4 (e.g. 92.3728) — the app negotiates fine-grained rates that 2 dp would round away.
export default function MoneyInput({ value, onChange, id, decimals = 2 }: {
  value: number; onChange: (n: number) => void; id?: string; decimals?: number
}) {
  return (
    <NumberInput id={id} value={value === 0 ? '' : value} min={0} decimalScale={decimals} step={1} hideControls allowNegative={false} thousandSeparator="," clampBehavior="strict"
      onChange={v => onChange(typeof v === 'number' ? v : (v === '' ? 0 : Number(v)))} />
  )
}
