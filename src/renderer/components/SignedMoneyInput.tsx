import { NumberInput } from '@mantine/core'
export default function SignedMoneyInput({ value, onChange, id }: { value: number; onChange: (n: number) => void; id?: string }) {
  return (
    <NumberInput id={id} value={value === 0 ? '' : value} decimalScale={2} step={1} hideControls allowNegative
      onChange={v => onChange(typeof v === 'number' ? v : (v === '' ? 0 : Number(v)))} />
  )
}
